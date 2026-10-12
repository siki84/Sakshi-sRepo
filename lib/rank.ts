import { allChips, GROUP_KEYS, normalize, type CustomChip, type Group, type Mix } from "./interests";
import type { Activity, InterestsState } from "./schemas";

/**
 * Deterministic ranking of the activity pool by the traveler's interest mix.
 * Groups take turns roughly in proportion to the mix (so a 40/30/30 mix reads that way
 * down the list); within a group, stronger recommendations and must-sees come first.
 */

export function groupOf(category: string, custom: CustomChip[]): Group | null {
  const g = allChips(custom).find((c) => c.key === category)?.group;
  return g && g !== "modifier" ? g : null;
}

function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function itemScore(a: Activity, interests: InterestsState): number {
  let s = a.buzz;
  if (a.tag === "must_see") s += 1;
  if (interests.chips.includes(a.category)) s += 0.75;
  if (interests.chips.includes("kid_friendly")) s += a.kidFriendly ? 0.5 : -1.5;
  for (const r of interests.rules) {
    if ((r.kind === "min_count" || r.kind === "must_include") && r.category === a.category) s += 1;
    if (r.kind === "must_include" && r.place && normName(a.name).includes(normName(r.place))) s += 100;
  }
  return s;
}

/** Ranked, filtered list (removed items and anything the requirements exclude are left out). */
export function rankActivities(pool: Activity[], interests: InterestsState, removed: string[] = []): Activity[] {
  const removedSet = new Set(removed);
  const excludedCats = new Set(interests.rules.filter((r) => r.kind === "exclude" && r.category).map((r) => r.category!));
  const items = pool.filter((a) => !removedSet.has(a.id) && !excludedCats.has(a.category));

  // Bucket by group; anything uncategorized rides with must-sees.
  const buckets = new Map<string, Activity[]>();
  for (const a of items) {
    const key = groupOf(a.category, interests.custom) ?? "other";
    buckets.set(key, [...(buckets.get(key) ?? []), a]);
  }
  for (const list of buckets.values()) {
    list.sort((x, y) => itemScore(y, interests) - itemScore(x, interests) || x.name.localeCompare(y.name));
  }

  // Target shares: the mix, with a small floor so iconic must-sees outside the mix still surface.
  const weights: Record<string, number> = {};
  for (const [key, list] of buckets) {
    const mixShare = key === "other" ? 0 : interests.mix[key as Group];
    const hasMustSee = list.some((a) => a.tag === "must_see");
    weights[key] = Math.max(mixShare, hasMustSee ? 8 : mixShare > 0 ? 0 : 3);
  }

  const out: Activity[] = [];
  const picked: Record<string, number> = {};
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  // Pinned items (must-include places) always lead.
  const pinned = items.filter((a) => itemScore(a, interests) >= 100);
  for (const a of pinned) {
    out.push(a);
    const key = groupOf(a.category, interests.custom) ?? "other";
    buckets.set(key, buckets.get(key)!.filter((x) => x.id !== a.id));
    picked[key] = (picked[key] ?? 0) + 1;
  }
  while (out.length < items.length) {
    let best: string | null = null;
    let bestDeficit = -Infinity;
    for (const [key, list] of buckets) {
      if (!list.length) continue;
      const deficit = (weights[key] / total) * (out.length + 1) - (picked[key] ?? 0);
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = key;
      }
    }
    if (!best) break;
    out.push(buckets.get(best)!.shift()!);
    picked[best] = (picked[best] ?? 0) + 1;
  }
  return out;
}

/** Share of time (by hours on site) per group — used for "your kept list vs your mix". */
export function hoursMix(items: Activity[], custom: CustomChip[]): Mix {
  const hours: Partial<Record<Group, number>> = {};
  for (const a of items) {
    const g = groupOf(a.category, custom);
    if (g) hours[g] = (hours[g] ?? 0) + a.durationHrs;
  }
  return normalize(hours);
}

export const MIX_GROUPS = GROUP_KEYS;
