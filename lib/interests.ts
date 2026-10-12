/**
 * Interest catalog and mix math. Chips roll up into a few groups; the traveler sets
 * the mix at group level (keeps the slider count small on mobile).
 */

export const GROUPS = {
  outdoors: { label: "Outdoors", emoji: "🥾" },
  city: { label: "City & culture", emoji: "🏛️" },
  food: { label: "Food & drink", emoji: "🍜" },
  nightlife: { label: "Nightlife", emoji: "🌙" },
  wellness: { label: "Wellness & slow", emoji: "🧖" },
} as const;
export type Group = keyof typeof GROUPS;
export const GROUP_KEYS = Object.keys(GROUPS) as Group[];

export type Chip = { key: string; label: string; group: Group | "modifier" };

export const CHIPS: Chip[] = [
  { key: "hiking", label: "Hiking", group: "outdoors" },
  { key: "water_sports", label: "Kayaking & water sports", group: "outdoors" },
  { key: "beaches", label: "Beaches", group: "outdoors" },
  { key: "nature", label: "Nature & parks", group: "outdoors" },
  { key: "day_trips", label: "Day trips", group: "outdoors" },
  { key: "museums", label: "Museums & history", group: "city" },
  { key: "architecture", label: "Architecture", group: "city" },
  { key: "markets", label: "Shopping & markets", group: "city" },
  { key: "photography", label: "Photography spots", group: "city" },
  { key: "neighborhoods", label: "Wandering neighborhoods", group: "city" },
  { key: "art", label: "Art & galleries", group: "city" },
  { key: "coffee", label: "Coffee shops", group: "food" },
  { key: "great_dinners", label: "Great dinners", group: "food" },
  { key: "street_food", label: "Street food", group: "food" },
  { key: "sweets", label: "Bakeries & desserts", group: "food" },
  { key: "wine_beer", label: "Wine & breweries", group: "food" },
  { key: "bars", label: "Bars", group: "nightlife" },
  { key: "clubbing", label: "Clubbing", group: "nightlife" },
  { key: "live_music", label: "Live music", group: "nightlife" },
  { key: "spa", label: "Wellness & spa", group: "wellness" },
  { key: "slow", label: "Slow mornings & downtime", group: "wellness" },
  { key: "kid_friendly", label: "Kid-friendly", group: "modifier" },
  { key: "accessible", label: "Step-free / accessible", group: "modifier" },
];

export type CustomChip = { key: string; label: string; group: Group };
export type Mix = Record<Group, number>;

export function allChips(custom: CustomChip[]): Chip[] {
  return [...CHIPS, ...custom];
}

export function chipLabel(key: string, custom: CustomChip[] = []): string {
  return allChips(custom).find((c) => c.key === key)?.label ?? key;
}

export function customKey(label: string): string {
  return `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)}`;
}

/** Groups that have at least one selected chip, in catalog order. */
export function activeGroups(selected: string[], custom: CustomChip[] = []): Group[] {
  const chips = allChips(custom);
  const groups = new Set(
    selected.map((k) => chips.find((c) => c.key === k)?.group).filter((g): g is Group => !!g && g !== "modifier"),
  );
  return GROUP_KEYS.filter((g) => groups.has(g));
}

export const emptyMix = (): Mix => ({ outdoors: 0, city: 0, food: 0, nightlife: 0, wellness: 0 });

/**
 * Integer percentages summing to exactly 100, proportional to `weights`
 * (largest-remainder rounding). Groups with weight 0 get 0.
 */
export function normalize(weights: Partial<Record<Group, number>>): Mix {
  const out = emptyMix();
  const entries = GROUP_KEYS.map((g) => [g, Math.max(0, weights[g] ?? 0)] as const).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return out;
  const raw = entries.map(([g, w]) => ({ g, exact: (w / total) * 100 }));
  for (const r of raw) out[r.g] = Math.floor(r.exact);
  let left = 100 - raw.reduce((s, r) => s + out[r.g], 0);
  for (const r of [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
    if (left <= 0) break;
    out[r.g] += 1;
    left -= 1;
  }
  return out;
}

/** Starting mix: proportional to how many chips were picked in each group. */
export function initialMix(selected: string[], custom: CustomChip[] = []): Mix {
  const chips = allChips(custom);
  const counts: Partial<Record<Group, number>> = {};
  for (const k of selected) {
    const g = chips.find((c) => c.key === k)?.group;
    if (g && g !== "modifier") counts[g] = (counts[g] ?? 0) + 1;
  }
  return normalize(counts);
}

/**
 * Keep the mix in sync when the set of active groups changes: existing groups keep
 * their relative weights, new groups enter at an average share, removed groups drop out.
 */
export function reconcileMix(mix: Mix, groups: Group[]): Mix {
  if (!groups.length) return emptyMix();
  const kept = groups.filter((g) => mix[g] > 0);
  const avg = kept.length ? kept.reduce((s, g) => s + mix[g], 0) / kept.length : 1;
  const weights: Partial<Record<Group, number>> = {};
  for (const g of groups) weights[g] = mix[g] > 0 ? mix[g] : avg;
  return normalize(weights);
}

/**
 * Move one slider and rebalance the others so the total stays 100. Other groups
 * shrink/grow in proportion to their current share (equally if they're all at 0).
 */
export function setGroupShare(mix: Mix, groups: Group[], group: Group, value: number): Mix {
  const others = groups.filter((g) => g !== group);
  if (!others.length) return { ...emptyMix(), [group]: 100 };
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const rest = 100 - v;
  const otherTotal = others.reduce((s, g) => s + mix[g], 0);
  const weights: Partial<Record<Group, number>> = {};
  for (const g of others) weights[g] = otherTotal > 0 ? (mix[g] / otherTotal) * rest : rest / others.length;
  const scaled = normalize({ ...weights, [group]: v });
  // normalize() can nudge the moved slider by ±1 while rounding; pin it and absorb the difference.
  const diff = scaled[group] - v;
  if (diff !== 0) {
    scaled[group] = v;
    const absorb = others.filter((g) => scaled[g] > 0 || diff > 0).sort((a, b) => scaled[b] - scaled[a])[0];
    if (absorb) scaled[absorb] += diff;
  }
  return scaled;
}
