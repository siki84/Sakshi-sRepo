import { haversineKm } from "./geo/haversine";
import { rankActivities } from "./rank";
import type { Activity, DiscoverState, InterestsState, LengthOption } from "./schemas";

/**
 * Deterministic trip-length estimate. Claude only explains these numbers; it never sets them.
 *
 * days = city days (activity hours ÷ comfortable hours/day for the traveler's pace)
 *      + one day per day-trip cluster (things far from the base)
 *      + half a day of travel per extra stop on a route
 *      + one day of buffer for arrival/departure half-days (trips over 2 days)
 */

/** Hours on site per day that feel right at each pace (1 = very relaxed … 5 = packed). */
export const HOURS_PER_DAY: Record<number, number> = { 1: 3.5, 2: 4.5, 3: 5.5, 4: 6.5, 5: 8 };
/** Anything further than this from its city center is treated as a day trip. */
export const DAY_TRIP_KM = 20;
/** Day-trip spots within this distance of each other share a day. */
const SAME_DAY_TRIP_KM = 15;

type Center = { lat: number; lng: number };

/**
 * How far from its center something must be to count as a day trip. Normally DAY_TRIP_KM.
 * But when fewer than a third of the picks are within that distance, the "center" isn't
 * where the trip happens (an island or region like Bali), so "far" becomes relative:
 * 1.5× the median distance of the picks.
 */
export function dayTripThresholdKm(items: Activity[], center: Center): number {
  if (items.length < 3) return DAY_TRIP_KM;
  const d = items.map((a) => haversineKm(a, center)).sort((x, y) => x - y);
  const nearShare = d.filter((km) => km <= DAY_TRIP_KM).length / d.length;
  if (nearShare >= 1 / 3) return DAY_TRIP_KM;
  return Math.max(DAY_TRIP_KM, d[Math.floor(d.length / 2)] * 1.5);
}

/** Groups far-flung activities into day trips (one day each). */
export function dayTripGroups(items: Activity[], centers: Map<string, Center>): Activity[][] {
  const thresholds = new Map<string, number>();
  for (const [city, c] of centers) thresholds.set(city, dayTripThresholdKm(items.filter((a) => a.city === city), c));
  const far = items.filter((a) => {
    const c = centers.get(a.city);
    return c ? haversineKm(a, c) > (thresholds.get(a.city) ?? DAY_TRIP_KM) : false;
  });
  const groups: Activity[][] = [];
  for (const a of far) {
    const g = groups.find((grp) => grp[0].city === a.city && haversineKm(grp[0], a) <= SAME_DAY_TRIP_KM);
    if (g) g.push(a);
    else groups.push([a]);
  }
  return groups;
}

export function estimate(items: Activity[], centers: Map<string, Center>, mainCity: string, pace: number): LengthOption {
  const perDay = HOURS_PER_DAY[Math.min(5, Math.max(1, pace))];
  const trips = dayTripGroups(items, centers);
  const tripIds = new Set(trips.flat().map((a) => a.id));
  const byCity = new Map<string, number>();
  for (const a of items) {
    if (tripIds.has(a.id)) continue;
    byCity.set(a.city, (byCity.get(a.city) ?? 0) + a.durationHrs);
  }
  // Each city needs at least one day if anything's planned there.
  const cityDays = [...byCity.values()].reduce((s, h) => s + Math.max(1, Math.ceil(h / perDay)), 0);
  const extraStops = [...byCity.keys()].filter((c) => c !== mainCity).length;
  const travelDays = Math.ceil(extraStops * 0.5);
  const base = Math.max(1, cityDays + trips.length + travelDays);
  const arrivalBuffer = base > 2 ? 1 : 0;
  return {
    days: base + arrivalBuffer,
    itemIds: items.map((a) => a.id),
    breakdown: {
      activityHours: Math.round(items.reduce((s, a) => s + a.durationHrs, 0) * 10) / 10,
      hoursPerDay: perDay,
      cityDays,
      dayTrips: trips.length,
      travelDays,
      arrivalBuffer,
    },
  };
}

/**
 * What the recommendation is based on: the traveler's kept picks, topped up with the
 * best-ranked remaining ideas if they kept only a few.
 */
export function selectionFor(
  discover: DiscoverState,
  interests: InterestsState,
  opts: { approxDays: number | null; pace: number },
): { items: Activity[]; usedTopRanked: boolean; extras: Activity[] } {
  const ranked = rankActivities(discover.pool, interests, discover.removed);
  const kept = ranked.filter((a) => discover.kept.includes(a.id));
  let items = kept;
  let usedTopRanked = false;
  if (kept.length < 5) {
    usedTopRanked = true;
    const targetHours = (opts.approxDays ?? 5) * HOURS_PER_DAY[opts.pace] * 0.85;
    items = [...kept];
    for (const a of ranked) {
      if (items.reduce((s, x) => s + x.durationHrs, 0) >= targetHours || items.length >= 40) break;
      if (!items.includes(a)) items.push(a);
    }
  }
  const chosen = new Set(items.map((a) => a.id));
  return { items, usedTopRanked, extras: ranked.filter((a) => !chosen.has(a.id)) };
}

/** The must-do core: must-sees, must-include places, and enough items to satisfy "at least N" rules. */
export function essentials(items: Activity[], interests: InterestsState): Activity[] {
  const out = new Set<Activity>();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const a of items) if (a.tag === "must_see") out.add(a);
  for (const r of interests.rules) {
    if (r.kind === "must_include" && r.place) {
      for (const a of items) if (norm(a.name).includes(norm(r.place))) out.add(a);
    }
    if (r.kind === "min_count" && r.category) {
      const have = [...out].filter((a) => a.category === r.category).length;
      const more = items.filter((a) => a.category === r.category && !out.has(a)).slice(0, Math.max(0, (r.count ?? 1) - have));
      for (const a of more) out.add(a);
    }
  }
  // Don't let "minimum" mean "every must-see in town": cap at the top ~60% of the selection.
  const list = items.filter((a) => out.has(a));
  return list.length > Math.ceil(items.length * 0.6) ? list.slice(0, Math.ceil(items.length * 0.6)) : list;
}

/** Minimum / ideal / generous options, always strictly increasing. */
export function lengthOptions(
  items: Activity[],
  extras: Activity[],
  interests: InterestsState,
  centers: Map<string, Center>,
  mainCity: string,
  pace: number,
): { min: LengthOption; ideal: LengthOption; generous: LengthOption } {
  const ideal = estimate(items, centers, mainCity, pace);
  // Minimum: only the essentials, at a brisker pace (and skipping optional day trips).
  const core = essentials(items, interests);
  const coreNoFarTrips = core.filter((a) => a.tag === "must_see" || !dayTripGroups([a], centers).length);
  let min = estimate(coreNoFarTrips.length ? coreNoFarTrips : items.slice(0, 3), centers, mainCity, Math.min(5, pace + 1));
  if (min.days >= ideal.days) min = { ...min, days: Math.max(1, ideal.days - 1) };
  // Generous: room for slower days plus the next-best ideas.
  const slack = Math.max(1, Math.round(ideal.days * 0.25));
  const perDay = HOURS_PER_DAY[pace];
  const room = slack * perDay * 0.6;
  const added: Activity[] = [];
  let hrs = 0;
  for (const a of extras) {
    if (hrs + a.durationHrs > room) continue;
    added.push(a);
    hrs += a.durationHrs;
  }
  const generous: LengthOption = {
    ...ideal,
    days: ideal.days + slack,
    itemIds: [...ideal.itemIds, ...added.map((a) => a.id)],
  };
  return { min, ideal, generous };
}

/** Which option is closest to what the traveler had in mind. */
export function closestOption(
  options: { min: LengthOption; ideal: LengthOption; generous: LengthOption },
  approxDays: number | null,
): "min" | "ideal" | "generous" | null {
  if (approxDays === null) return null;
  const keys = ["min", "ideal", "generous"] as const;
  return keys.reduce((best, k) =>
    Math.abs(options[k].days - approxDays) < Math.abs(options[best].days - approxDays) ? k : best,
  );
}
