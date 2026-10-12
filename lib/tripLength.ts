import { z } from "zod";
import { cached, cacheKey } from "./cache";
import { runStructured } from "./ai/client";
import { RESEARCH_SYSTEM } from "./ai/prompts/fit";
import { geocode } from "./geo/nominatim";
import { closestOption, lengthOptions, selectionFor } from "./length";
import { describeProfile } from "./profileText";
import { approxDaysOf, describeLength, describeTiming } from "./timing";
import { chipLabel } from "./interests";
import type { Activity, LengthState, Profile, Trip } from "./schemas";

export const LengthAdviceAi = z.object({
  headline: z
    .string()
    .describe('One line recommendation with the ideal number of days and why, e.g. "Lisbon: 5 days — 3 for the big sights, 2 to slow down"'),
  min: z.string().describe("1–2 sentences: what the minimum covers and what it cuts"),
  ideal: z.string().describe("1–2 sentences: why this is the sweet spot"),
  generous: z.string().describe("1–2 sentences: what the extra days add (name the added ideas / day trips)"),
  approxNote: z
    .string()
    .nullable()
    .describe("If the traveler had a rough length in mind: one sentence comparing it with the options; otherwise null"),
});

const list = (items: Activity[], custom: Parameters<typeof chipLabel>[1]) =>
  items.map((a) => `- ${a.name} (${chipLabel(a.category, custom)}, ${a.tag === "must_see" ? "must-see" : "local gem"}, ${a.durationHrs}h, ${a.area}${a.city ? `, ${a.city}` : ""})`).join("\n") || "- (none)";

export class NotReadyError extends Error {}

/** Compute the three options (deterministic) and Claude's explanation of them. */
export async function computeLength(trip: Trip, profile: Profile): Promise<LengthState> {
  const dest = trip.state.destination?.confirmed;
  const interests = trip.state.interests;
  const discover = trip.state.discover;
  if (!dest || !interests || !discover?.pool.length) throw new NotReadyError("Finish discovery first.");

  const approxDays = approxDaysOf(dest.timing);
  const centers = new Map([[dest.place.name, { lat: dest.place.lat, lng: dest.place.lng }]]);
  for (const s of dest.stops) {
    const hit = await geocode(s);
    if (hit) centers.set(s, { lat: hit.lat, lng: hit.lng });
  }
  const { items, usedTopRanked, extras } = selectionFor(discover, interests, { approxDays, pace: profile.pace });
  const options = lengthOptions(items, extras, interests, centers, dest.place.name, profile.pace);

  const byId = new Map(discover.pool.map((a) => [a.id, a]));
  const minSet = new Set(options.min.itemIds);
  const cut = items.filter((a) => !minSet.has(a.id));
  const added = options.generous.itemIds.filter((id) => !options.ideal.itemIds.includes(id)).map((id) => byId.get(id)!);
  const b = options.ideal.breakdown;
  const closest = closestOption(options, approxDays);

  const key = cacheKey("length-advice", { v: 1, options, approxDays, pace: profile.pace, dest: dest.place.name });
  const advice = await cached(key, 30, async () => {
    const { data } = await runStructured({
      task: "length-advice",
      system: RESEARCH_SYSTEM,
      prompt: `Destination: ${dest.place.name}${dest.stops.length ? ` → ${dest.stops.join(" → ")}` : ""}
When: ${describeTiming(dest.timing)}
Rough length they had in mind: ${describeLength(dest.timing)}

Traveler:
${describeProfile(profile)}

The app computed these trip lengths (do not change the numbers):
- Minimum: ${options.min.days} days — just the essentials at a brisker pace.
- Ideal: ${options.ideal.days} days — ${b.activityHours}h of activities at ~${b.hoursPerDay}h/day = ${b.cityDays} city day(s), ${b.dayTrips} day trip(s), ${b.travelDays} travel day(s) between stops, ${b.arrivalBuffer} day of arrival/departure buffer.
- Generous: ${options.generous.days} days — slower days plus extra ideas.
${closest ? `Closest to what they had in mind: ${closest} (${options[closest].days} days).` : ""}

Activities in the ideal plan:
${list(items, interests.custom)}

Cut in the minimum:
${list(cut, interests.custom)}

Added in the generous option:
${list(added, interests.custom)}

Explain each option in plain language for this traveler, naming specific activities, neighborhoods, or day trips. Be concrete, not salesy.`,
      schema: LengthAdviceAi,
      effort: "low",
      maxTokens: 4000,
      fixtureInput: { options, approxDays, place: dest.place.name, cut: cut.map((a) => a.name), added: added.map((a) => a.name) },
      check: (d) => {
        const p: string[] = [];
        if (!d.headline.includes(String(options.ideal.days))) p.push(`headline must state the ideal length (${options.ideal.days} days)`);
        if (approxDays !== null && !d.approxNote) p.push("approxNote is required: compare their rough length with the options");
        if (approxDays === null && d.approxNote) p.push("approxNote must be null (no rough length given)");
        return p;
      },
    });
    return data;
  });

  const prev = trip.state.length;
  return {
    selectionIds: items.map((a) => a.id),
    usedTopRanked,
    options,
    advice,
    approxDays,
    chosenDays: prev?.chosenDays ?? null,
    startDate: prev?.startDate ?? (dest.timing.kind === "dates" ? dest.timing.start : null),
    forecast: prev?.forecast ?? null,
    generatedAt: new Date().toISOString(),
  };
}
