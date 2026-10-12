import crypto from "node:crypto";
import { z } from "zod";
import { cached, cacheKey } from "./cache";
import { geocode } from "./geo/nominatim";
import { haversineKm } from "./geo/haversine";
import { runStructured, type ProgressFn, type SearchResult } from "./ai/client";
import { verifiedSources } from "./ai/sources";
import { DISCOVER_SYSTEM, discoverBatchPrompt, moreLikeThisPrompt } from "./ai/prompts/discover";
import { allChips, chipLabel, activeGroups, GROUPS, type Group } from "./interests";
import { describeProfile } from "./profileText";
import { approxDaysOf, describeLength, describeTiming } from "./timing";
import { formatTemp } from "./units";
import type { Activity, BestTime, Climate, DiscoverState, InterestsState, Place, Profile, Timing } from "./schemas";

const DISCOVER_VERSION = 1;
const CACHE_DAYS = 14;
/** Activities further than this from the city center are rejected (≈ day-trip range). */
const MAX_KM_FROM_CENTER = 120;
/** Bounding box half-size used to verify locations with the geocoder (~35 km). */
const VERIFY_RADIUS_DEG = 0.35;

export const DiscoverAi = z.object({
  activities: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      tag: z.enum(["must_see", "local_gem"]),
      why: z.string().describe("1–2 lines: why it's worth it, specific not generic"),
      area: z.string().describe("Neighborhood or district"),
      durationHrs: z.number().describe("Typical time on site in hours"),
      bestTime: z.enum(["morning", "afternoon", "evening", "any"]),
      setting: z.enum(["indoor", "outdoor", "mixed"]),
      kidFriendly: z.boolean(),
      buzz: z.number().int(),
      lat: z.number(),
      lng: z.number(),
      sourceUrls: z.array(z.string()).describe("URLs from your web search results; never invent URLs"),
    }),
  ),
});
type RawActivity = z.infer<typeof DiscoverAi>["activities"][number];

export type Batch = {
  /** "must_see", a group key, or "stop:<name>". */
  key: string;
  kind: "must_see" | "group" | "stop";
  city: string;
  chips: string[];
  count: number;
};

type Ctx = {
  profile: Profile;
  interests: InterestsState;
  timing: Timing;
  climate: Climate | null;
};

// ---------- pure helpers ----------

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(the|a|an|de|da|do|la|le|el)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function activityId(name: string, city: string): string {
  return crypto.createHash("sha1").update(`${normalizeName(name)}|${city.toLowerCase()}`).digest("hex").slice(0, 12);
}

function tokenOverlap(a: string, b: string): number {
  const A = new Set(normalizeName(a).split(" ").filter(Boolean));
  const B = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / Math.min(A.size, B.size);
}

/** Merge duplicates (same name, or similar name very close by), combining sources. */
export function dedupe(items: Activity[]): Activity[] {
  const out: Activity[] = [];
  for (const a of items) {
    const dup = out.find(
      (b) =>
        normalizeName(a.name) === normalizeName(b.name) ||
        (tokenOverlap(a.name, b.name) >= 0.6 && haversineKm(a, b) < 0.4),
    );
    if (!dup) {
      out.push({ ...a, sources: [...a.sources] });
      continue;
    }
    for (const s of a.sources) if (!dup.sources.some((x) => x.url === s.url)) dup.sources.push(s);
    if (a.tag === "must_see") dup.tag = "must_see";
    dup.buzz = Math.max(dup.buzz, a.buzz);
    if (!dup.locationVerified && a.locationVerified) Object.assign(dup, { lat: a.lat, lng: a.lng, locationVerified: true });
  }
  return out;
}

/** Excluded categories and places from the traveler's hard requirements. */
export function exclusions(interests: InterestsState): { categories: Set<string>; places: string[] } {
  const ex = interests.rules.filter((r) => r.kind === "exclude");
  return {
    categories: new Set(ex.map((r) => r.category).filter((c): c is string => !!c)),
    places: ex.map((r) => r.place).filter((p): p is string => !!p),
  };
}

export function isExcluded(a: Pick<Activity, "name" | "category">, interests: InterestsState): boolean {
  const ex = exclusions(interests);
  return ex.categories.has(a.category) || ex.places.some((p) => normalizeName(a.name).includes(normalizeName(p)));
}

/** Which research calls are needed: must-sees + one per active interest group + one per extra stop. */
export function planBatches(interests: InterestsState, city: string, stops: string[], days: number | null = null): Batch[] {
  // Longer trips need a bigger pool to choose from; short ones a tighter one.
  const scale = days === null ? 1 : Math.min(2, Math.max(0.7, days / 5));
  const chips = allChips(interests.custom);
  const selected = interests.chips.filter((k) => chips.find((c) => c.key === k)?.group !== "modifier");
  const groups = activeGroups(interests.chips, interests.custom);
  const batches: Batch[] = [{ key: "must_see", kind: "must_see", city, chips: [...selected].sort(), count: Math.round(10 * Math.min(scale, 1.4)) }];
  for (const g of groups) {
    const inGroup = selected.filter((k) => chips.find((c) => c.key === k)?.group === g).sort();
    // Bigger slice of the mix → more options to choose from.
    const count = Math.max(5, Math.min(20, Math.round((interests.mix[g] / 5) * scale)));
    batches.push({ key: g, kind: "group", city, chips: inGroup, count });
  }
  for (const s of stops) batches.push({ key: `stop:${s}`, kind: "stop", city: s, chips: [...selected].sort(), count: 10 });
  return batches;
}

/** Semantic checks for a batch response. */
export function checkBatch(
  d: z.infer<typeof DiscoverAi>,
  ctx: { searchResults: Map<string, SearchResult> },
  opts: { allowed: Set<string>; center: { lat: number; lng: number }; min: number },
): string[] {
  const problems: string[] = [];
  if (d.activities.length < opts.min) problems.push(`return at least ${opts.min} activities`);
  const badCat = d.activities.filter((a) => !opts.allowed.has(a.category));
  if (badCat.length) problems.push(`invalid category for: ${badCat.map((a) => a.name).join(", ")} (use only the listed keys)`);
  const unsourced = d.activities.filter((a) => !verifiedSources(a.sourceUrls, ctx.searchResults).length);
  if (unsourced.length > Math.max(1, d.activities.length / 3)) {
    problems.push(`too many items without a source URL from your searches: ${unsourced.map((a) => a.name).join(", ")}`);
  }
  const far = d.activities.filter((a) => haversineKm(a, opts.center) > MAX_KM_FROM_CENTER);
  if (far.length > Math.max(1, d.activities.length / 4)) {
    problems.push(`these coordinates are far from the city — fix them or drop the items: ${far.map((a) => a.name).join(", ")}`);
  }
  return problems;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Validated raw items → Activities (unsourced / far-away / excluded items dropped). */
export function toActivities(
  raw: RawActivity[],
  search: Map<string, SearchResult>,
  opts: { city: string; center: { lat: number; lng: number }; interests: InterestsState; batch: string; similarTo?: string },
): Activity[] {
  const out: Activity[] = [];
  for (const a of raw) {
    const sources = verifiedSources(a.sourceUrls, search);
    if (!sources.length) continue;
    if (haversineKm(a, opts.center) > MAX_KM_FROM_CENTER) continue;
    if (isExcluded(a, opts.interests)) continue;
    out.push({
      id: activityId(a.name, opts.city),
      name: a.name.trim(),
      category: a.category,
      tag: a.tag,
      why: a.why,
      area: a.area,
      city: opts.city,
      durationHrs: clamp(Math.round(a.durationHrs * 4) / 4, 0.25, 12),
      bestTime: a.bestTime as BestTime,
      setting: a.setting,
      kidFriendly: a.kidFriendly,
      buzz: clamp(Math.round(a.buzz), 1, 5),
      lat: a.lat,
      lng: a.lng,
      locationVerified: false,
      sources,
      similarTo: opts.similarTo ?? null,
      batch: opts.batch,
    });
  }
  return out;
}

// ---------- research ----------

function weatherText(c: Climate | null, units: "F" | "C"): string {
  if (!c) return "unknown";
  return `highs ~${formatTemp(c.avgHighF, units)}, lows ~${formatTemp(c.avgLowF, units)}, rain on ~${Math.round(c.rainyDaysPerMonth)} days/month${c.daylightHours ? `, ${c.daylightHours}h daylight` : ""}`;
}

function requirementsText(interests: InterestsState): string {
  const keep = interests.rules.filter((r) => r.kind !== "exclude");
  return keep.length ? keep.map((r) => r.summary.replace(/^\[Sample\]\s*/, "")).join("; ") : "none";
}

function excludedText(interests: InterestsState): string {
  const ex = interests.rules.filter((r) => r.kind === "exclude");
  return ex.length ? ex.map((r) => r.text).join("; ") : "nothing specific";
}

function modifiersText(interests: InterestsState): string {
  const m: string[] = [];
  if (interests.chips.includes("kid_friendly")) m.push("Traveling with kids: prefer kid-friendly options and flag ones that aren't.");
  if (interests.chips.includes("accessible")) m.push("Needs step-free / accessible options where possible.");
  return m.join("\n");
}

function allowedFor(batch: Batch, interests: InterestsState): { key: string; label: string }[] {
  const chips = allChips(interests.custom).filter((c) => c.group !== "modifier");
  // Must-sees and stops can be anything iconic; group batches stick to that group's catalog.
  const pool = batch.kind === "group" ? chips.filter((c) => c.group === batch.key) : chips;
  return pool.map((c) => ({ key: c.key, label: c.label }));
}

async function runBatch(batch: Batch, center: { lat: number; lng: number }, ctx: Ctx, emit: ProgressFn): Promise<Activity[]> {
  const { interests, profile, timing } = ctx;
  const allowed = allowedFor(batch, interests);
  const focusText = batch.chips.map((k) => chipLabel(k, interests.custom)).join(", ");
  const key = cacheKey("discover", {
    v: DISCOVER_VERSION,
    city: batch.city,
    center: [center.lat.toFixed(2), center.lng.toFixed(2)],
    kind: batch.kind,
    chips: batch.chips,
    count: batch.count,
    rules: interests.rules,
    mods: modifiersText(interests),
    month: describeTiming(timing),
    travelers: profile.travelers,
  });
  return cached(key, CACHE_DAYS, async () => {
    const label =
      batch.kind === "must_see" ? "must-sees" : batch.kind === "stop" ? `highlights in ${batch.city}` : `${GROUPS[batch.key as Group].label.toLowerCase()} (${focusText})`;
    emit({ type: "status", message: `Researching ${label}…` });
    const { data, searchResults } = await runStructured({
      task: "discover-batch",
      system: DISCOVER_SYSTEM,
      prompt: discoverBatchPrompt({
        city: batch.city,
        timingText: describeTiming(timing),
        lengthText: describeLength(timing),
        profileText: describeProfile(profile),
        weatherText: weatherText(ctx.climate, profile.units),
        kind: batch.kind,
        focusText,
        allowedCategories: allowed,
        requirementsText: requirementsText(interests),
        excludedText: excludedText(interests),
        modifiersText: modifiersText(interests),
        count: batch.count,
      }),
      schema: DiscoverAi,
      webSearch: { maxUses: 10 },
      effort: "medium",
      onProgress: emit,
      fixtureInput: { batch, center, allowed: allowed.map((a) => a.key), rules: interests.rules },
      check: (d, c) =>
        checkBatch(d, c, { allowed: new Set(allowed.map((a) => a.key)), center, min: Math.ceil(batch.count / 2) }),
    });
    return toActivities(data.activities, searchResults, { city: batch.city, center, interests, batch: batch.key });
  });
}

/** Re-geocode each activity inside a box around its city; trust the geocoder when it finds a match. */
export async function verifyLocations(
  items: Activity[],
  centers: Map<string, { lat: number; lng: number; countryCode: string | null }>,
  emit: ProgressFn,
): Promise<Activity[]> {
  const out: Activity[] = [];
  let i = 0;
  for (const a of items) {
    i++;
    if (i === 1 || i % 10 === 0) emit({ type: "status", message: `Checking locations on the map (${i}/${items.length})…` });
    if (a.locationVerified) {
      out.push(a);
      continue;
    }
    const c = centers.get(a.city);
    try {
      const hit = c
        ? await geocode(`${a.name}, ${a.city}`, {
            within: { lat: c.lat, lng: c.lng, radiusDeg: VERIFY_RADIUS_DEG },
            countryCodes: c.countryCode ? [c.countryCode] : undefined,
          })
        : null;
      out.push(hit ? { ...a, lat: hit.lat, lng: hit.lng, locationVerified: true } : a);
    } catch {
      out.push(a); // geocoder hiccup: keep the model's estimate, flagged as approximate
    }
  }
  return out;
}

export type DiscoverInput = {
  place: Place;
  stops: string[];
  timing: Timing;
  climate: Climate | null;
  profile: Profile;
  interests: InterestsState;
  previous?: DiscoverState;
};

/**
 * Build (or refresh) the activity pool. With `previous`, only batches whose inputs changed are
 * re-researched; kept/removed choices carry over by activity id.
 */
export async function runDiscovery(input: DiscoverInput, emit: ProgressFn): Promise<DiscoverState> {
  const { place, stops, profile, interests, timing, climate, previous } = input;
  const ctx: Ctx = { profile, interests, timing, climate };
  const centers = new Map<string, { lat: number; lng: number; countryCode: string | null }>([
    [place.name, { lat: place.lat, lng: place.lng, countryCode: place.countryCode }],
  ]);
  for (const s of stops) {
    const hit = await geocode(s);
    if (hit) centers.set(s, { lat: hit.lat, lng: hit.lng, countryCode: hit.countryCode });
    else emit({ type: "status", message: `Couldn't find stop "${s}" on the map — skipping it` });
  }
  const batches = planBatches(interests, place.name, stops.filter((s) => centers.has(s)), approxDaysOf(timing));
  const prevBatches = previous?.researchedFor.place === place.name ? previous.researchedFor.batches : {};
  const changed = batches.filter((b) => JSON.stringify(prevBatches[b.key]) !== JSON.stringify(b.chips));
  const unchangedKeys = new Set(batches.filter((b) => !changed.includes(b)).map((b) => b.key));

  if (previous && !changed.length) emit({ type: "status", message: "Nothing new to research." });
  const results = await Promise.allSettled(changed.map((b) => runBatch(b, centers.get(b.city)!, ctx, emit)));
  const fresh: Activity[] = [];
  const failures: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") fresh.push(...r.value);
    else failures.push(`${changed[i].key}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  });
  if (!fresh.length && failures.length && !previous) throw new Error(failures[0]);
  for (const f of failures) emit({ type: "status", message: `Some research failed (${f}); showing what we have.` });

  // Keep previous items from batches that didn't change, "more like this" finds, and anything kept.
  const keptIds = new Set(previous?.kept ?? []);
  const carried = (previous?.pool ?? []).filter(
    (a) => a.similarTo !== null || keptIds.has(a.id) || unchangedKeys.has(a.batch),
  );
  const verified = await verifyLocations(dedupe([...carried, ...fresh]), centers, emit);
  const pool = verified.filter((a) => !isExcluded(a, interests));
  const ids = new Set(pool.map((a) => a.id));
  return {
    pool,
    kept: (previous?.kept ?? []).filter((id) => ids.has(id)),
    removed: (previous?.removed ?? []).filter((id) => ids.has(id)),
    researchedFor: {
      place: place.name,
      stops: stops.filter((s) => centers.has(s)),
      batches: Object.fromEntries(
        batches
          .filter((b) => unchangedKeys.has(b.key) || results[changed.indexOf(b)]?.status === "fulfilled")
          .map((b) => [b.key, b.chips]),
      ),
    },
    updatedAt: new Date().toISOString(),
  };
}

/** "More like this": 4–6 similar finds near the seed's city, appended to the pool. */
export async function moreLikeThis(
  seed: Activity,
  state: DiscoverState,
  input: Omit<DiscoverInput, "previous" | "stops">,
  emit: ProgressFn,
): Promise<Activity[]> {
  const { profile, interests, timing, place } = input;
  const center = seed.city === place.name ? { lat: place.lat, lng: place.lng } : { lat: seed.lat, lng: seed.lng };
  const allowed = allChips(interests.custom)
    .filter((c) => c.group !== "modifier")
    .map((c) => ({ key: c.key, label: c.label }));
  emit({ type: "status", message: `Looking for more like ${seed.name}…` });
  const { data, searchResults } = await runStructured({
    task: "discover-more",
    system: DISCOVER_SYSTEM,
    prompt: moreLikeThisPrompt({
      city: seed.city,
      timingText: describeTiming(timing),
      profileText: describeProfile(profile),
      seed,
      exclude: state.pool.map((a) => a.name),
      allowedCategories: allowed,
      excludedText: excludedText(interests),
    }),
    schema: DiscoverAi,
    webSearch: { maxUses: 6 },
    effort: "medium",
    onProgress: emit,
    fixtureInput: { seed, center, allowed: allowed.map((a) => a.key) },
    check: (d, c) => checkBatch(d, c, { allowed: new Set(allowed.map((a) => a.key)), center, min: 2 }),
  });
  const existing = new Set(state.pool.map((a) => a.id));
  const items = toActivities(data.activities, searchResults, { city: seed.city, center, interests, batch: "more", similarTo: seed.id }).filter(
    (a) => !existing.has(a.id),
  );
  const centers = new Map([[seed.city, { ...center, countryCode: place.countryCode }]]);
  return verifyLocations(dedupe(items), centers, emit);
}
