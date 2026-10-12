import { z } from "zod";
import { cached, cacheKey } from "./cache";
import { runStructured } from "./ai/client";
import { allChips, chipLabel, type CustomChip } from "./interests";
import type { RequirementRule } from "./schemas";

const KINDS = ["min_count", "max_count", "exclude", "must_include", "time_pref", "other"] as const;

export const RequirementsAi = z.object({
  rules: z.array(
    z.object({
      text: z.string().describe("The requirement exactly as the traveler wrote it"),
      kind: z.enum(KINDS),
      category: z.string().nullable().describe("Closest category key from the list, or null"),
      count: z.number().int().nullable().describe("For min_count/max_count: the number; otherwise null"),
      place: z.string().nullable().describe("A specific named place/experience if mentioned, else null"),
      summary: z.string().describe('Short interpretation, e.g. "At least 2 hikes" or "No clubbing"'),
    }),
  ),
});

const SYSTEM = `You turn a traveler's hard requirements for a trip into structured, checkable rules.
Rule kinds:
- min_count: at least N of a category ("at least two hikes", "one really nice dinner" → 1)
- max_count: at most N ("no more than one museum a day" → max_count 1, mention "per day" in summary)
- exclude: never include ("no clubbing", "skip churches")
- must_include: a specific named place or experience ("must see the Alhambra") — put it in "place"
- time_pref: timing preferences ("slow mornings", "nothing before 10am")
- other: anything else; keep the meaning in summary
Map each requirement to the closest category key from the provided list when one fits; otherwise use null.
Keep the same order as the input, one rule per requirement. Respond with JSON.`;

export function checkRules(
  rules: z.infer<typeof RequirementsAi>["rules"],
  requirements: string[],
  validKeys: Set<string>,
): string[] {
  const problems: string[] = [];
  if (rules.length !== requirements.length) {
    problems.push(`return exactly ${requirements.length} rules, one per requirement, in order`);
  }
  rules.forEach((r, i) => {
    if (r.category !== null && !validKeys.has(r.category)) {
      problems.push(`rules[${i}].category "${r.category}" is not one of the allowed keys (use null if none fits)`);
    }
    if ((r.kind === "min_count" || r.kind === "max_count") && (r.count === null || r.count < 0)) {
      problems.push(`rules[${i}] (${r.kind}) needs a count`);
    }
    if ((r.kind === "min_count" || r.kind === "exclude") && r.category === null && r.place === null) {
      problems.push(`rules[${i}] (${r.kind}) needs a category or a place`);
    }
  });
  return problems;
}

/** Interpret free-text requirements into rules (cached by wording + catalog). */
export async function interpretRequirements(
  requirements: string[],
  custom: CustomChip[],
  context: { destination: string | null },
): Promise<RequirementRule[]> {
  if (!requirements.length) return [];
  const chips = allChips(custom);
  const validKeys = new Set(chips.map((c) => c.key));
  const key = cacheKey("requirements", { v: 1, requirements, keys: [...validKeys].sort(), dest: context.destination });
  return cached(key, 90, async () => {
    const { data } = await runStructured({
      task: "requirements",
      system: SYSTEM,
      prompt: `Destination: ${context.destination ?? "not chosen yet"}
Category keys:
${chips.map((c) => `- ${c.key}: ${c.label}`).join("\n")}

Requirements:
${requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
      schema: RequirementsAi,
      effort: "low",
      maxTokens: 4000,
      fixtureInput: { requirements, keys: [...validKeys] },
      check: (d) => checkRules(d.rules, requirements, validKeys),
    });
    // Keep the traveler's original wording even if the model paraphrased it.
    return data.rules.map((r, i) => ({ ...r, text: requirements[i] ?? r.text }));
  });
}

/**
 * Make chips consistent with hard requirements: a "at least N hikes" adds Hiking if missing;
 * "no clubbing" removes Clubbing if selected. Returns what changed so we can tell the traveler.
 */
export function applyRules(
  chips: string[],
  rules: RequirementRule[],
  custom: CustomChip[] = [],
): { chips: string[]; notices: string[] } {
  const next = new Set(chips);
  const notices: string[] = [];
  for (const r of rules) {
    if (!r.category) continue;
    const label = chipLabel(r.category, custom);
    if ((r.kind === "min_count" || r.kind === "must_include") && (r.count ?? 1) > 0 && !next.has(r.category)) {
      next.add(r.category);
      notices.push(`Added “${label}” because you asked for: “${r.text}”.`);
    }
    if (r.kind === "exclude" && next.has(r.category)) {
      next.delete(r.category);
      notices.push(`Removed “${label}” because you said: “${r.text}”.`);
    }
  }
  return { chips: [...next], notices };
}
