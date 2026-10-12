import type { Fixture } from "./index";

/**
 * MOCK_AI: a tiny keyword parser standing in for Claude's interpretation.
 * Good enough for tests ("at least two hikes", "one nice dinner", "no clubbing").
 */
const WORDS: Record<string, string> = {
  hike: "hiking", hikes: "hiking", hiking: "hiking",
  dinner: "great_dinners", dinners: "great_dinners",
  club: "clubbing", clubs: "clubbing", clubbing: "clubbing",
  museum: "museums", museums: "museums",
  beach: "beaches", beaches: "beaches",
  coffee: "coffee", bars: "bars", bar: "bars",
};
const NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4 };

export function requirementsFixture(input: unknown): Fixture {
  const { requirements, keys } = input as { requirements: string[]; keys: string[] };
  const rules = requirements.map((text) => {
    const t = text.toLowerCase();
    const cat = Object.entries(WORDS).find(([w]) => new RegExp(`\\b${w}\\b`).test(t))?.[1] ?? null;
    const category = cat && keys.includes(cat) ? cat : null;
    const n = t.match(/\b(\d+|one|a|an|two|three|four)\b/)?.[1];
    const count = n ? (NUM[n] ?? Number(n)) : null;
    if (/^(no|skip|avoid|never)\b/.test(t)) {
      return { text, kind: "exclude", category, count: null, place: category ? null : text, summary: `[Sample] No ${category ?? text}` };
    }
    if (/at least|one|two|three|\d/.test(t) && category) {
      return { text, kind: "min_count", category, count: count ?? 1, place: null, summary: `[Sample] At least ${count ?? 1} × ${category}` };
    }
    return { text, kind: "other", category, count: null, place: null, summary: `[Sample] ${text}` };
  });
  return { data: { rules }, queries: [], searchResults: [] };
}
