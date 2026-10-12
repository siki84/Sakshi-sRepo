import { z } from "zod";
import { runStructured, type ProgressFn } from "../ai/client";
import { RESEARCH_SYSTEM } from "../ai/prompts/fit";
import { verifiedSources } from "../ai/sources";
import { haversineKm } from "../geo/haversine";
import { chipLabel } from "../interests";
import { describeProfile } from "../profileText";
import { centroid, type City } from "./engine";
import type { Activity, BlockKey, InterestsState, Itinerary, PlanDay, Profile, Stay } from "../schemas";

const BLOCKS: BlockKey[] = ["morning", "afternoon", "evening"];
const KIND_TEXT: Record<PlanDay["kind"], string> = {
  arrival: "arrival half-day",
  departure: "departure half-day",
  travel: "travel half-day (moving to this city)",
  daytrip: "day trip",
  full: "full day",
  free: "free / slack day",
};

export function describeItinerary(it: Itinerary, byId: Map<string, Activity>, withIds = false): string {
  return it.days
    .map((d) => {
      const blocks = BLOCKS.map((b) => {
        const names = d.blocks[b].map((id) => {
          const a = byId.get(id);
          return a ? (withIds ? `[${a.id}] ${a.name}` : a.name) : null;
        }).filter(Boolean);
        return names.length ? `  ${b}: ${names.join("; ")}` : null;
      }).filter(Boolean);
      return `Day ${d.n}${d.date ? ` (${d.date})` : ""} — ${KIND_TEXT[d.kind]} in ${d.area}, ${d.city.split(",")[0]}${d.weatherNote ? ` [${d.weatherNote}]` : ""}${d.sprawl ? " [spread out]" : ""}\n${blocks.join("\n") || "  (nothing scheduled)"}`;
    })
    .join("\n");
}

// ---------- titles & summaries ----------

export const NarrativeAi = z.object({
  variants: z.array(
    z.object({
      key: z.enum(["frontload", "easy"]),
      tagline: z.string().describe("One line on the shape of this plan"),
      days: z.array(
        z.object({
          n: z.number().int(),
          title: z.string().describe('Short, specific, e.g. "Belém & the riverfront"'),
          summary: z.string().describe("1–2 sentences: the flow of the day and one practical tip"),
        }),
      ),
    }),
  ),
});

export async function writeNarrative(
  variants: Itinerary[],
  byId: Map<string, Activity>,
  ctx: { profile: Profile; interests: InterestsState; place: string },
  emit: ProgressFn,
): Promise<Itinerary[]> {
  emit({ type: "status", message: "Writing up your two itineraries…" });
  const { data } = await runStructured({
    task: "plan-narrative",
    system: RESEARCH_SYSTEM,
    prompt: `Destination: ${ctx.place}
Traveler:
${describeProfile(ctx.profile)}
Hard requirements: ${ctx.interests.rules.map((r) => r.text).join("; ") || "none"}

The app already decided which activities go on which day (don't move anything). Write a tagline per plan and a title + short summary per day.

${variants.map((v) => `PLAN "${v.key}" (${v.name}):\n${describeItinerary(v, byId)}`).join("\n\n")}`,
    schema: NarrativeAi,
    effort: "low",
    maxTokens: 8000,
    fixtureInput: { variants: variants.map((v) => ({ key: v.key, days: v.days.map((d) => ({ n: d.n, area: d.area, kind: d.kind })) })) },
    check: (d) => {
      const p: string[] = [];
      for (const v of variants) {
        const got = d.variants.find((x) => x.key === v.key);
        if (!got) p.push(`missing plan "${v.key}"`);
        else if (JSON.stringify(got.days.map((x) => x.n).sort((a, b) => a - b)) !== JSON.stringify(v.days.map((x) => x.n))) {
          p.push(`plan "${v.key}" needs exactly days ${v.days.map((x) => x.n).join(", ")}`);
        }
      }
      return p;
    },
  });
  return variants.map((v) => {
    const got = data.variants.find((x) => x.key === v.key)!;
    return {
      ...v,
      tagline: got.tagline,
      days: v.days.map((d) => {
        const t = got.days.find((x) => x.n === d.n)!;
        return { ...d, title: t.title, summary: t.summary };
      }),
    };
  });
}

// ---------- where to stay ----------

export const StaysAi = z.object({
  stays: z.array(
    z.object({
      name: z.string().describe("Neighborhood name"),
      why: z.string().describe("Why it suits this plan (mention which days are close)"),
      walkability: z.string(),
      transit: z.string(),
      noise: z.string(),
      priceFeel: z.enum(["$", "$$", "$$$", "$$$$"]),
      bestFor: z.string().describe('e.g. "first-timers who want to walk everywhere"'),
      lat: z.number(),
      lng: z.number(),
      sourceUrls: z.array(z.string()).describe("URLs from your web search results"),
    }),
  ),
});

export async function recommendStays(
  it: Itinerary,
  byId: Map<string, Activity>,
  cities: City[],
  ctx: { profile: Profile; interests: InterestsState },
  emit: ProgressFn,
): Promise<Stay[]> {
  const out: Stay[] = [];
  for (const city of cities.slice(0, 3)) {
    const days = it.days.filter((d) => d.city === city.name && d.kind !== "daytrip");
    const dayPoints = days
      .map((d) => [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening].map((id) => byId.get(id)!).filter(Boolean))
      .filter((xs) => xs.length)
      .map((xs) => ({ ...centroid(xs), hours: xs.reduce((s, a) => s + a.durationHrs, 0), area: xs[0].area }));
    const areas = [...new Set(dayPoints.map((p) => p.area))];
    if (!dayPoints.length) continue;
    const weighted = {
      lat: dayPoints.reduce((s, p) => s + p.lat * p.hours, 0) / dayPoints.reduce((s, p) => s + p.hours, 0),
      lng: dayPoints.reduce((s, p) => s + p.lng * p.hours, 0) / dayPoints.reduce((s, p) => s + p.hours, 0),
    };
    const want = cities.length > 1 ? 1 : 2;
    emit({ type: "status", message: `Finding the best base in ${city.name.split(",")[0]}…` });
    const nightlife = ctx.interests.mix.nightlife >= 15;
    const { data, searchResults } = await runStructured({
      task: "plan-stays",
      system: RESEARCH_SYSTEM,
      prompt: `City: ${city.name}
Traveler:
${describeProfile(ctx.profile)}
${nightlife ? "They want nightlife nearby." : "Quiet nights matter more than nightlife."}

Their days cluster around (area, lat/lng, hours of activities):
${dayPoints.map((p) => `- ${p.area}: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)} (${p.hours}h)`).join("\n")}
Weighted center of the plan: ${weighted.lat.toFixed(4)}, ${weighted.lng.toFixed(4)}

Recommend ${want} neighborhood${want > 1 ? "s" : ""} to stay in, close to where these days cluster. For each: why it suits this plan, and honest trade-offs on walkability, transit, noise, and price feel. No hotel names. Cite sources from your web searches.`,
      schema: StaysAi,
      webSearch: { maxUses: 4 },
      effort: "low",
      maxTokens: 6000,
      onProgress: emit,
      fixtureInput: { city: city.name, center: weighted, want, areas },
      check: (d, c) => {
        const p: string[] = [];
        if (d.stays.length < 1) p.push("recommend at least one neighborhood");
        if (new Set(d.stays.map((s) => s.name.toLowerCase())).size !== d.stays.length) p.push("each neighborhood must be different");
        for (const s of d.stays) {
          if (!verifiedSources(s.sourceUrls, c.searchResults).length) p.push(`${s.name}: needs a source URL from your searches`);
          if (haversineKm(s, weighted) > 15) p.push(`${s.name}: coordinates are far from where the days cluster`);
        }
        return p;
      },
    });
    for (const s of data.stays.slice(0, want)) {
      const avg = dayPoints.reduce((sum, p) => sum + haversineKm(s, p), 0) / dayPoints.length;
      out.push({
        name: `${s.name}${cities.length > 1 ? `, ${city.name.split(",")[0]}` : ""}`,
        why: s.why,
        walkability: s.walkability,
        transit: s.transit,
        noise: s.noise,
        priceFeel: s.priceFeel,
        bestFor: s.bestFor,
        lat: s.lat,
        lng: s.lng,
        avgKmToDays: Math.round(avg * 10) / 10,
        sources: verifiedSources(s.sourceUrls, searchResults),
      });
    }
  }
  return out;
}

// ---------- chat refinement ----------

export const RefineAi = z.object({
  reply: z.string().describe("Short, friendly confirmation of what changed (or why you couldn't)"),
  ops: z.array(
    z.object({
      op: z.enum(["move", "swap_days", "add", "remove", "lighten_day"]),
      activityId: z.string().nullable().describe("For move/add/remove: the [id] of the activity"),
      day: z.number().int().nullable().describe("For swap_days (first day) and lighten_day"),
      toDay: z.number().int().nullable().describe("For move/add: target day; for swap_days: the second day"),
      block: z.enum(["morning", "afternoon", "evening"]).nullable(),
    }),
  ),
  dayTitles: z
    .array(z.object({ n: z.number().int(), title: z.string(), summary: z.string() }))
    .describe("Updated title + summary for every day whose content changed"),
});
export type RefineOps = z.infer<typeof RefineAi>;

export function checkOps(d: RefineOps, it: Itinerary, byId: Map<string, Activity>): string[] {
  const p: string[] = [];
  const dayNs = new Set(it.days.map((x) => x.n));
  const inPlan = new Set(it.days.flatMap((x) => [...x.blocks.morning, ...x.blocks.afternoon, ...x.blocks.evening]));
  d.ops.forEach((o, i) => {
    const needId = o.op === "move" || o.op === "add" || o.op === "remove";
    if (needId && (!o.activityId || !byId.has(o.activityId))) p.push(`ops[${i}]: activityId must be one of the listed [ids]`);
    if ((o.op === "move" || o.op === "add") && (o.toDay === null || !dayNs.has(o.toDay))) p.push(`ops[${i}]: toDay must be a valid day number`);
    if (o.op === "swap_days" && (o.day === null || o.toDay === null || !dayNs.has(o.day) || !dayNs.has(o.toDay))) p.push(`ops[${i}]: swap_days needs day and toDay`);
    if (o.op === "lighten_day" && (o.day === null || !dayNs.has(o.day))) p.push(`ops[${i}]: lighten_day needs a valid day`);
    if (o.op === "remove" && o.activityId && !inPlan.has(o.activityId)) p.push(`ops[${i}]: that activity isn't in the plan`);
  });
  for (const t of d.dayTitles) if (!dayNs.has(t.n)) p.push(`dayTitles: no day ${t.n}`);
  return p;
}

export async function interpretChat(
  message: string,
  it: Itinerary,
  byId: Map<string, Activity>,
  candidates: Activity[],
  ctx: { profile: Profile; interests: InterestsState; history: { role: string; text: string }[] },
): Promise<RefineOps> {
  const { data } = await runStructured({
    task: "plan-refine",
    system: `You edit a travel itinerary by returning structured operations. The app applies them and re-checks the plan.
Operations: move (activity to another day/block), swap_days (swap two days' contents), add (an activity from the "can add" list), remove, lighten_day (drop the least important stops of a day).
Only use the [ids] given. If the request needs something that isn't in the lists (e.g. a place we haven't researched), make no op for it and say so in reply, suggesting "More like this" on the Discover step. Respond with JSON.`,
    prompt: `Traveler:
${describeProfile(ctx.profile)}

Current plan:
${describeItinerary(it, byId, true)}

Can add (not in the plan yet):
${candidates.map((a) => `[${a.id}] ${a.name} — ${chipLabel(a.category, ctx.interests.custom)}, ${a.area}, ${a.durationHrs}h, ${a.tag === "must_see" ? "must-see" : "local gem"}`).join("\n") || "(none)"}

Recent conversation:
${ctx.history.slice(-6).map((m) => `${m.role}: ${m.text}`).join("\n") || "(none)"}

Request: ${message}`,
    schema: RefineAi,
    effort: "low",
    maxTokens: 6000,
    fixtureInput: { message, days: it.days.map((d) => ({ n: d.n, ids: [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening] })), candidates: candidates.map((a) => ({ id: a.id, category: a.category, name: a.name })) },
    check: (d) => checkOps(d, it, byId),
  });
  return data;
}
