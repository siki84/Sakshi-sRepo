import { haversineKm, type LatLng } from "../geo/haversine";
import { DAY_TRIP_KM, HOURS_PER_DAY, dayTripGroups } from "../length";
import { hoursMix, rankActivities } from "../rank";
import { isoDay } from "../timing";
import type {
  Activity,
  BlockKey,
  Climate,
  DailyForecast,
  InterestsState,
  Itinerary,
  PlanDay,
  RequirementCheck,
} from "../schemas";

/**
 * Deterministic itinerary engine. It decides *what goes where*: which activities fit,
 * which day each lands on (geographic clusters), the order within a day, rough time
 * blocks, and weather-aware day placement. Claude only writes titles and summaries.
 */

export type City = { name: string; lat: number; lng: number };

export type EngineInput = {
  pool: Activity[];
  kept: string[];
  removed: string[];
  interests: InterestsState;
  days: number;
  startDate: string | null;
  cities: City[]; // main city first, then route stops in order
  pace: number;
  climate: Climate | null;
  forecast: DailyForecast[] | null;
};

type Slot = { kind: PlanDay["kind"]; city: string; cap: number };

/** Walking-ish day: stops this far from the day's middle (km) start to feel sprawling. */
const SPRAWL_RADIUS_KM = 3;
const SPRAWL_ROUTE_KM = 10;
/** First pass: only join a day whose middle is within this distance. */
const JOIN_RADIUS_KM = 4;
const HOT_F = 85;
/** Days that can trade places for weather (not arrival/departure/travel half-days). */
const WHOLE_DAY = new Set<PlanDay["kind"]>(["full", "daytrip", "free"]);

const sumHours = (xs: Activity[]) => xs.reduce((s, a) => s + a.durationHrs, 0);

export function centroid(xs: LatLng[]): LatLng {
  return { lat: xs.reduce((s, a) => s + a.lat, 0) / xs.length, lng: xs.reduce((s, a) => s + a.lng, 0) / xs.length };
}

/** Nearest-neighbour route starting from `start` (or the item nearest the city center). */
export function orderRoute(items: Activity[], from: LatLng): Activity[] {
  const left = [...items];
  const out: Activity[] = [];
  let cur = from;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (haversineKm(cur, left[i]) < haversineKm(cur, left[bi])) bi = i;
    const [next] = left.splice(bi, 1);
    out.push(next);
    cur = next;
  }
  return out;
}

export function routeKm(items: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < items.length; i++) km += haversineKm(items[i - 1], items[i]);
  return Math.round(km * 10) / 10;
}

export function isSprawling(items: Activity[], kind: PlanDay["kind"]): boolean {
  if (kind === "daytrip" || items.length < 2) return false;
  const c = centroid(items);
  return items.some((a) => haversineKm(a, c) > SPRAWL_RADIUS_KM) || routeKm(items) > SPRAWL_ROUTE_KM;
}

/** Day slots: arrival/departure half-days, travel half-days when switching cities on a route. */
export function daySlots(days: number, cities: City[], cityHours: Map<string, number>, perDay: number): Slot[] {
  // Allocate days to cities in proportion to planned hours (≥1 each), main city absorbs rounding.
  const total = [...cityHours.values()].reduce((a, b) => a + b, 0) || 1;
  const alloc = cities.map((c, i) =>
    i === 0 ? 0 : Math.max(1, Math.round(((cityHours.get(c.name) ?? 0) / total) * days)),
  );
  alloc[0] = Math.max(1, days - alloc.slice(1).reduce((a, b) => a + b, 0));
  const slots: Slot[] = [];
  cities.forEach((c, ci) => {
    for (let i = 0; i < alloc[ci]; i++) {
      let kind: PlanDay["kind"] = "full";
      if (ci > 0 && i === 0) kind = "travel";
      slots.push({ kind, city: c.name, cap: perDay });
    }
  });
  const trimmed = slots.slice(0, days);
  if (days >= 3) {
    trimmed[0] = { ...trimmed[0], kind: "arrival" };
    trimmed[trimmed.length - 1] = { ...trimmed[trimmed.length - 1], kind: "departure" };
  }
  for (const s of trimmed) {
    if (s.kind === "arrival" || s.kind === "departure" || s.kind === "travel") s.cap = perDay * 0.5;
    else if (days === 2) s.cap = perDay * 0.8;
  }
  return trimmed;
}

/**
 * Capacity-aware k-means: groups items into `caps.length` geographic clusters whose total
 * hours roughly respect each cap. Returns clusters (some may be empty) and items that didn't fit.
 */
export function clusterIntoDays(items: Activity[], caps: number[], center: LatLng): { clusters: Activity[][]; overflow: Activity[] } {
  const k = caps.length;
  if (!k) return { clusters: [], overflow: items };
  // Farthest-point seeding from the highest-priority item (items arrive priority-ordered).
  const seeds: LatLng[] = [];
  if (items.length) seeds.push(items[0]);
  while (seeds.length < Math.min(k, items.length)) {
    let best = items[0];
    let bestD = -1;
    for (const a of items) {
      const d = Math.min(...seeds.map((s) => haversineKm(s, a)));
      if (d > bestD) {
        bestD = d;
        best = a;
      }
    }
    seeds.push(best);
  }
  while (seeds.length < k) seeds.push(center);

  let clusters: Activity[][] = [];
  let overflow: Activity[] = [];
  let centers = seeds;
  for (let iter = 0; iter < 8; iter++) {
    clusters = Array.from({ length: k }, () => []);
    overflow = [];
    const load = new Array(k).fill(0);
    for (const a of items) {
      const order = centers.map((c, i) => [i, haversineKm(c, a)] as const).sort((x, y) => x[1] - y[1]);
      // Only join a day that's nearby and has room; otherwise it waits in "optional"
      // (a full day in the wrong neighborhood is worse than one fewer stop).
      const fit = order.find(
        ([i, d]) => load[i] === 0 || (load[i] + a.durationHrs <= caps[i] * 1.15 && d <= JOIN_RADIUS_KM),
      );
      if (!fit) {
        overflow.push(a);
        continue;
      }
      clusters[fit[0]].push(a);
      load[fit[0]] += a.durationHrs;
    }
    const next = clusters.map((cl, i) => (cl.length ? centroid(cl) : centers[i]));
    if (next.every((c, i) => haversineKm(c, centers[i]) < 0.05)) break;
    centers = next;
  }
  // Second pass: an almost-empty day is worse than a slightly spread-out one. Fill days that are
  // under half full with the nearest leftovers (they may get flagged as spread out).
  const load = clusters.map((cl) => sumHours(cl));
  const still: Activity[] = [];
  for (const a of overflow) {
    const options = clusters
      .map((_, i) => i)
      .filter((i) => load[i] + a.durationHrs <= caps[i] * 1.15)
      // Far-ish items only join days that are still under half full.
      .filter((i) => load[i] < caps[i] * 0.5 || haversineKm(centers[i], a) <= SPRAWL_RADIUS_KM * 1.5)
      .sort((x, y) => haversineKm(centers[x], a) - haversineKm(centers[y], a));
    if (!options.length) {
      still.push(a);
      continue;
    }
    clusters[options[0]].push(a);
    load[options[0]] += a.durationHrs;
  }
  return { clusters, overflow: still };
}

/** Assign ordered stops to morning / afternoon / evening, honoring best time and heat. */
export function assignBlocks(route: Activity[], cap: number, hot: boolean): Record<BlockKey, string[]> {
  const blocks: Record<BlockKey, string[]> = { morning: [], afternoon: [], evening: [] };
  const room: Record<BlockKey, number> = { morning: cap * 0.4, afternoon: cap * 0.4, evening: cap * 0.3 };
  const keys: BlockKey[] = ["morning", "afternoon", "evening"];
  let cursor = 0;
  for (const a of route) {
    let pref: BlockKey | null = a.bestTime === "any" ? null : a.bestTime;
    // In the heat, outdoor things move out of the afternoon.
    if (hot && a.setting === "outdoor" && pref !== "evening") pref = room.morning > 0 ? "morning" : "evening";
    let target: BlockKey;
    if (pref) target = pref;
    else {
      while (cursor < 2 && room[keys[cursor]] <= 0) cursor++;
      target = keys[cursor];
    }
    blocks[target].push(a.id);
    room[target] -= a.durationHrs;
  }
  return blocks;
}

function areaLabel(items: Activity[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const a of items) counts.set(a.area, (counts.get(a.area) ?? 0) + a.durationHrs);
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);
  if (!top.length) return fallback;
  return top.length > 1 && counts.get(top[1])! > 0.6 * counts.get(top[0])! ? `${top[0]} & ${top[1]}` : top[0];
}

/** Deterministic requirement checks against the scheduled activities. */
export function checkRequirements(days: PlanDay[], byId: Map<string, Activity>, interests: InterestsState): RequirementCheck[] {
  const dayItems = days.map((d) => [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening].map((id) => byId.get(id)!).filter(Boolean));
  const all = dayItems.flat();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const where = (pred: (a: Activity) => boolean) =>
    dayItems.map((xs, i) => (xs.some(pred) ? `Day ${days[i].n}` : null)).filter(Boolean).join(", ");
  return interests.rules.map((r): RequirementCheck => {
    const matches = (a: Activity) =>
      (r.category !== null && a.category === r.category) || (r.place !== null && norm(a.name).includes(norm(r.place)));
    const label = r.summary.replace(/^\[Sample\]\s*/, "");
    switch (r.kind) {
      case "min_count": {
        const n = all.filter(matches).length;
        const need = r.count ?? 1;
        return { text: r.text, status: n >= need ? "met" : "not_met", detail: `${n} of ${need} scheduled${n ? ` (${where(matches)})` : ""}` };
      }
      case "max_count": {
        const perDay = /day/i.test(r.text + r.summary);
        const worst = perDay ? Math.max(0, ...dayItems.map((xs) => xs.filter(matches).length)) : all.filter(matches).length;
        return {
          text: r.text,
          status: worst <= (r.count ?? 0) ? "met" : "not_met",
          detail: perDay ? `At most ${worst} on any day` : `${worst} in total`,
        };
      }
      case "exclude": {
        const n = all.filter(matches).length;
        return { text: r.text, status: n === 0 ? "met" : "not_met", detail: n === 0 ? "None scheduled" : `${n} scheduled (${where(matches)})` };
      }
      case "must_include": {
        const n = all.filter(matches).length;
        return {
          text: r.text,
          status: n > 0 ? "met" : "not_met",
          detail: n > 0 ? `Scheduled on ${where(matches)}` : "Not in your discovery list yet — add it there, or ask in chat",
        };
      }
      default:
        return { text: r.text, status: "info", detail: `${label} — not automatically checkable; reflected in the day notes` };
    }
  });
}

/** Recompute route order, distances, sprawl, mix, and checks after any change. */
export function finalizeItinerary(it: Itinerary, byId: Map<string, Activity>, interests: InterestsState, cities: City[]): Itinerary {
  const cityCenter = new Map(cities.map((c) => [c.name, c]));
  const days = it.days.map((d) => {
    const ids = [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening].filter((id) => byId.has(id));
    const items = ids.map((id) => byId.get(id)!);
    const center = cityCenter.get(d.city) ?? cities[0];
    // Re-order within each block along a nearest-neighbour route.
    let cursor: LatLng = center;
    const blocks = { ...d.blocks };
    for (const b of ["morning", "afternoon", "evening"] as const) {
      const ordered = orderRoute(d.blocks[b].filter((id) => byId.has(id)).map((id) => byId.get(id)!), cursor);
      blocks[b] = ordered.map((a) => a.id);
      if (ordered.length) cursor = ordered[ordered.length - 1];
    }
    const routed = [...blocks.morning, ...blocks.afternoon, ...blocks.evening].map((id) => byId.get(id)!);
    return {
      ...d,
      blocks,
      area: items.length ? areaLabel(items, d.area) : d.area,
      routeKm: routeKm(routed),
      sprawl: isSprawling(routed, d.kind),
    };
  });
  const scheduled = days.flatMap((d) => [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening]).map((id) => byId.get(id)!);
  const scheduledIds = new Set(scheduled.map((a) => a.id));
  return {
    ...it,
    days,
    optional: it.optional.filter((id) => !scheduledIds.has(id) && byId.has(id)),
    achievedMix: hoursMix(scheduled, interests.custom),
    checks: checkRequirements(days, byId, interests),
  };
}

function isHot(input: EngineInput, day: PlanDay): boolean {
  if (day.forecast) return day.forecast.highF >= HOT_F;
  return (input.climate?.avgHighF ?? 0) >= HOT_F;
}

function outdoorHours(xs: Activity[]) {
  return xs.filter((a) => a.setting !== "indoor").reduce((s, a) => s + a.durationHrs, 0);
}

/**
 * Build one variant.
 * - "frontload": your pace, days with the most must-sees first.
 * - "easy": ~75% of the capacity, busy and light days alternate, the rest goes to Optional.
 */
export function buildVariant(input: EngineInput, key: "frontload" | "easy"): Itinerary {
  const fill = key === "easy" ? 0.75 : 1;
  const perDay = HOURS_PER_DAY[Math.min(5, Math.max(1, input.pace))] * fill;
  const byId = new Map(input.pool.map((a) => [a.id, a]));
  const ranked = rankActivities(input.pool, input.interests, input.removed);
  const keptSet = new Set(input.kept);
  // Priority: kept first (rank order), then everything else by rank.
  const priority = [...ranked.filter((a) => keptSet.has(a.id)), ...ranked.filter((a) => !keptSet.has(a.id))];
  const cityNames = new Set(input.cities.map((c) => c.name));
  const usable = priority.filter((a) => cityNames.has(a.city));
  const centers = new Map(input.cities.map((c) => [c.name, c]));

  // Hours wanted per city (kept items, else top-ranked) to size the route.
  const cityHours = new Map<string, number>();
  for (const a of usable.slice(0, Math.max(10, input.kept.length))) cityHours.set(a.city, (cityHours.get(a.city) ?? 0) + a.durationHrs);
  const slots = daySlots(input.days, input.cities, cityHours, perDay);

  const planned: { slot: Slot; items: Activity[]; kind: PlanDay["kind"] }[] = [];
  const used = new Set<string>();
  for (const city of input.cities) {
    const citySlots = slots.filter((s) => s.city === city.name);
    if (!citySlots.length) continue;
    const cityItems = usable.filter((a) => a.city === city.name);
    // Day trips: worth a full day only if they hold something kept or a must-see; ≤ 1 per 3 days.
    const trips = dayTripGroups(cityItems, centers)
      .filter((g) => g.some((a) => keptSet.has(a.id) || a.tag === "must_see"))
      .slice(0, Math.floor(citySlots.filter((s) => s.kind === "full").length / 3));
    const fullIdx = citySlots.map((s, i) => (s.kind === "full" ? i : -1)).filter((i) => i >= 0);
    const tripSlots = new Set(fullIdx.slice(-trips.length || fullIdx.length).slice(0, trips.length));
    let t = 0;
    citySlots.forEach((s, i) => {
      if (tripSlots.has(i)) {
        const g = trips[t++];
        g.forEach((a) => used.add(a.id));
        planned.push({ slot: s, items: g, kind: "daytrip" });
      }
    });
    const rest = citySlots.filter((_, i) => !tripSlots.has(i));
    const near = cityItems.filter((a) => !used.has(a.id) && haversineKm(a, city) <= DAY_TRIP_KM);
    const capTotal = rest.reduce((s2, x) => s2 + x.cap, 0);
    const chosen: Activity[] = [];
    let hrs = 0;
    for (const a of near) {
      if (hrs + a.durationHrs > capTotal * 1.05 && !(keptSet.has(a.id) && key === "frontload")) continue;
      chosen.push(a);
      hrs += a.durationHrs;
    }
    const { clusters } = clusterIntoDays(chosen, rest.map((x) => x.cap), city);
    // Lightest clusters go to half-days; the rest to full days.
    const order = rest.map((s, i) => ({ s, i })).sort((x, y) => x.s.cap - y.s.cap);
    const byLoad = clusters.map((c, i) => ({ c, i })).sort((x, y) => sumHours(x.c) - sumHours(y.c));
    const assigned = new Map<number, Activity[]>();
    order.forEach(({ i }, j) => assigned.set(i, byLoad[j]?.c ?? []));
    rest.forEach((s, i) => {
      const items = assigned.get(i) ?? [];
      items.forEach((a) => used.add(a.id));
      planned.push({ slot: s, items, kind: items.length ? s.kind : s.kind === "full" ? "free" : s.kind });
    });
  }

  // Keep slot order (arrival … departure; cities in route order); reorder full days by variant shape.
  const slotOrder = new Map(slots.map((s, i) => [s, i]));
  planned.sort((a, b) => slotOrder.get(a.slot)! - slotOrder.get(b.slot)!);
  const fullPositions = planned.map((p, i) => (p.kind === "full" ? i : -1)).filter((i) => i >= 0);
  const fulls = fullPositions.map((i) => planned[i]);
  const mustSees = (p: (typeof planned)[number]) => p.items.filter((a) => a.tag === "must_see").length;
  if (key === "frontload") fulls.sort((a, b) => mustSees(b) - mustSees(a) || sumHours(b.items) - sumHours(a.items));
  else {
    const sorted = [...fulls].sort((a, b) => sumHours(b.items) - sumHours(a.items));
    fulls.splice(0, fulls.length, ...sorted.map((_, i) => (i % 2 === 0 ? sorted[i / 2] : sorted[sorted.length - 1 - (i - 1) / 2])));
  }
  fullPositions.forEach((pos, j) => (planned[pos] = fulls[j]));

  // Dates + forecast.
  const days: PlanDay[] = planned.map((p, i) => {
    const date = input.startDate ? isoDay(new Date(new Date(`${input.startDate}T00:00:00Z`).getTime() + i * 86_400_000)) : null;
    const f = date ? input.forecast?.find((x) => x.date === date) : undefined;
    return {
      n: i + 1,
      date,
      city: p.slot.city,
      area: p.slot.city.split(",")[0],
      kind: p.kind,
      title: "",
      summary: "",
      weatherNote: null,
      blocks: { morning: [], afternoon: [], evening: [] },
      routeKm: 0,
      sprawl: false,
      forecast: f ? { highF: f.highF, lowF: f.lowF, precipProb: f.precipProb, precipMm: f.precipMm } : null,
    };
  });
  const itemsByDay = planned.map((p) => p.items);

  // Weather: move outdoor-heavy full days off likely-rain days (same city only).
  const wet = (d: PlanDay) => (d.forecast?.precipProb ?? 0) >= 60;
  for (let i = 0; i < days.length; i++) {
    if (!wet(days[i]) || outdoorHours(itemsByDay[i]) < 1.5 || !WHOLE_DAY.has(days[i].kind)) continue;
    let best = -1;
    for (let j = 0; j < days.length; j++) {
      if (j === i || wet(days[j]) || days[j].city !== days[i].city || !WHOLE_DAY.has(days[j].kind)) continue;
      if (outdoorHours(itemsByDay[j]) < outdoorHours(itemsByDay[i]) && (best < 0 || outdoorHours(itemsByDay[j]) < outdoorHours(itemsByDay[best]))) best = j;
    }
    if (best >= 0) {
      [itemsByDay[i], itemsByDay[best]] = [itemsByDay[best], itemsByDay[i]];
      [days[i].kind, days[best].kind] = [days[best].kind, days[i].kind];
      days[best].weatherNote = "Driest day in the forecast — saved for the outdoor stops.";
      days[i].weatherNote = "Rain likely — mostly indoor stops today.";
    } else {
      days[i].weatherNote = "Rain likely — have an indoor backup in mind.";
    }
  }

  // Time blocks.
  days.forEach((d, i) => {
    const center = centers.get(d.city) ?? input.cities[0];
    const route = orderRoute(itemsByDay[i], center);
    const cap = d.kind === "daytrip" ? HOURS_PER_DAY[input.pace] * 1.3 : planned[i].slot.cap;
    const hot = isHot(input, d);
    d.blocks = assignBlocks(route, cap, hot);
    if (hot && !d.weatherNote && outdoorHours(itemsByDay[i]) > 0) d.weatherNote = "Hot afternoons — outdoor stops are in the morning or evening.";
  });

  const scheduled = new Set(days.flatMap((d) => [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening]));
  const optional = [...priority.filter((a) => keptSet.has(a.id) && !scheduled.has(a.id)), ...priority.filter((a) => !keptSet.has(a.id) && !scheduled.has(a.id))]
    .slice(0, 15)
    .map((a) => a.id);

  return finalizeItinerary(
    {
      key,
      name: key === "frontload" ? "Big sights first" : "Easy-going mix",
      tagline: "",
      days,
      optional,
      achievedMix: { outdoors: 0, city: 0, food: 0, nightlife: 0, wellness: 0 },
      checks: [],
    },
    byId,
    input.interests,
    input.cities,
  );
}
