import { finalizeItinerary, type City } from "./engine";
import type { RefineOps } from "./ai";
import type { Activity, BlockKey, InterestsState, Itinerary } from "../schemas";

const BLOCKS: BlockKey[] = ["morning", "afternoon", "evening"];

function strip(it: Itinerary, id: string): Itinerary {
  return {
    ...it,
    optional: it.optional.filter((x) => x !== id),
    days: it.days.map((d) => ({
      ...d,
      blocks: {
        morning: d.blocks.morning.filter((x) => x !== id),
        afternoon: d.blocks.afternoon.filter((x) => x !== id),
        evening: d.blocks.evening.filter((x) => x !== id),
      },
    })),
  };
}

function defaultBlock(a: Activity | undefined): BlockKey {
  return a && a.bestTime !== "any" ? a.bestTime : "afternoon";
}

/** Put an activity on a day (removing it from wherever it was). */
export function placeActivity(it: Itinerary, id: string, dayN: number, block: BlockKey | null, byId: Map<string, Activity>): Itinerary {
  const out = strip(it, id);
  const b = block ?? defaultBlock(byId.get(id));
  out.days = out.days.map((d) => (d.n === dayN ? { ...d, blocks: { ...d.blocks, [b]: [...d.blocks[b], id] } } : d));
  return out;
}

export function removeActivity(it: Itinerary, id: string): Itinerary {
  const out = strip(it, id);
  return { ...out, optional: [id, ...out.optional] };
}

export function swapDays(it: Itinerary, a: number, b: number): Itinerary {
  const da = it.days.find((d) => d.n === a)!;
  const db = it.days.find((d) => d.n === b)!;
  const carry = (from: typeof da) => ({ blocks: from.blocks, kind: from.kind, title: from.title, summary: from.summary, area: from.area });
  return {
    ...it,
    days: it.days.map((d) => (d.n === a ? { ...d, ...carry(db), city: db.city } : d.n === b ? { ...d, ...carry(da), city: da.city } : d)),
  };
}

/** Drop the least important stops (non-kept, lowest buzz) until the day is ~40% lighter. */
export function lightenDay(it: Itinerary, dayN: number, byId: Map<string, Activity>, kept: Set<string>): Itinerary {
  const d = it.days.find((x) => x.n === dayN)!;
  const ids = BLOCKS.flatMap((b) => d.blocks[b]);
  const hours = (xs: string[]) => xs.reduce((s, id) => s + (byId.get(id)?.durationHrs ?? 0), 0);
  const target = hours(ids) * 0.6;
  const order = [...ids].sort((x, y) => {
    const ax = byId.get(x)!, ay = byId.get(y)!;
    return Number(kept.has(x)) - Number(kept.has(y)) || Number(ax.tag === "must_see") - Number(ay.tag === "must_see") || ax.buzz - ay.buzz;
  });
  let out = it;
  let left = ids;
  for (const id of order) {
    if (hours(left) <= target || left.length <= 1) break;
    out = removeActivity(out, id);
    left = left.filter((x) => x !== id);
  }
  return out;
}

/** Apply chat ops, then re-route, re-check clustering, mix, and requirements. */
export function applyOps(
  it: Itinerary,
  ops: RefineOps,
  ctx: { byId: Map<string, Activity>; interests: InterestsState; cities: City[]; kept: Set<string> },
): { itinerary: Itinerary; changedDays: number[] } {
  let out = it;
  const changed = new Set<number>();
  const dayOf = (id: string) => out.days.find((d) => BLOCKS.some((b) => d.blocks[b].includes(id)))?.n;
  for (const o of ops.ops) {
    if ((o.op === "move" || o.op === "add") && o.activityId && o.toDay !== null) {
      const from = dayOf(o.activityId);
      if (from) changed.add(from);
      out = placeActivity(out, o.activityId, o.toDay, o.block, ctx.byId);
      changed.add(o.toDay);
    } else if (o.op === "remove" && o.activityId) {
      const from = dayOf(o.activityId);
      if (from) changed.add(from);
      out = removeActivity(out, o.activityId);
    } else if (o.op === "swap_days" && o.day !== null && o.toDay !== null) {
      out = swapDays(out, o.day, o.toDay);
    } else if (o.op === "lighten_day" && o.day !== null) {
      out = lightenDay(out, o.day, ctx.byId, ctx.kept);
      changed.add(o.day);
    }
  }
  for (const t of ops.dayTitles) {
    out = { ...out, days: out.days.map((d) => (d.n === t.n ? { ...d, title: t.title, summary: t.summary } : d)) };
  }
  return { itinerary: finalizeItinerary(out, ctx.byId, ctx.interests, ctx.cities), changedDays: [...changed] };
}

/** Plain-language warnings after an edit: new sprawl, broken requirements. */
export function editWarnings(before: Itinerary, after: Itinerary): string[] {
  const w: string[] = [];
  for (const d of after.days) {
    const was = before.days.find((x) => x.n === d.n);
    if (d.sprawl && !was?.sprawl) w.push(`Day ${d.n} is now spread out (${d.routeKm} km between stops) — consider moving something to a nearby day.`);
  }
  for (const c of after.checks) {
    const was = before.checks.find((x) => x.text === c.text);
    if (c.status === "not_met" && was?.status !== "not_met") w.push(`Heads up: “${c.text}” is no longer met (${c.detail}).`);
  }
  return w;
}
