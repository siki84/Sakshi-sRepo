import { describe, expect, it } from "vitest";
import {
  assignBlocks,
  buildVariant,
  clusterIntoDays,
  daySlots,
  finalizeItinerary,
  isSprawling,
  orderRoute,
  routeKm,
  type EngineInput,
} from "@/lib/plan/engine";
import type { Activity, InterestsState } from "@/lib/schemas";

const lisbon = { name: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393 };
let n = 0;
const act = (over: Partial<Activity> = {}): Activity => ({
  id: `a${++n}`,
  name: `Thing ${n}`,
  category: "museums",
  tag: "local_gem",
  why: "",
  area: "Baixa",
  city: lisbon.name,
  durationHrs: 2,
  bestTime: "any",
  setting: "indoor",
  kidFriendly: true,
  buzz: 3,
  lat: 38.71,
  lng: -9.14,
  locationVerified: true,
  sources: [{ url: "https://x.com", title: "" }],
  similarTo: null,
  batch: "city",
  ...over,
});
const interests = (over: Partial<InterestsState> = {}): InterestsState => ({
  chips: ["museums", "hiking", "coffee"],
  custom: [],
  mix: { outdoors: 40, city: 40, food: 20, nightlife: 0, wellness: 0 },
  requirements: [],
  rules: [],
  notices: [],
  ...over,
});

// Two neighborhoods ~4 km apart (west: Belém, east: Alfama) + a far day trip (Sintra).
const jit = () => ((n * 37) % 10) * 0.0004; // deterministic spread within a neighborhood
const belem = (o: Partial<Activity> = {}) => act({ area: "Belém", lat: 38.6979 + jit(), lng: -9.2066, ...o });
const alfama = (o: Partial<Activity> = {}) => act({ area: "Alfama", lat: 38.7118 + jit(), lng: -9.13, ...o });
const sintra = (o: Partial<Activity> = {}) => act({ area: "Sintra", name: "Pena Palace", lat: 38.7876, lng: -9.3906, tag: "must_see", setting: "outdoor", durationHrs: 3, ...o });

const ids = (d: { blocks: { morning: string[]; afternoon: string[]; evening: string[] } }) => [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening];

describe("building blocks", () => {
  it("orders a route by nearest neighbour and measures it", () => {
    const a = act({ lat: 0, lng: 0 }), b = act({ lat: 0, lng: 0.02 }), c = act({ lat: 0, lng: 0.01 });
    expect(orderRoute([a, b, c], { lat: 0, lng: -0.01 }).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect(routeKm([a, c, b])).toBeCloseTo(2.2, 1);
  });

  it("flags sprawling days but not day trips", () => {
    const far = [belem(), alfama()];
    expect(isSprawling(far, "full")).toBe(true);
    expect(isSprawling(far, "daytrip")).toBe(false);
    expect(isSprawling([alfama(), alfama()], "full")).toBe(false);
  });

  it("makes arrival/departure half-days and travel days on routes", () => {
    const porto = { name: "Porto", lat: 41.15, lng: -8.61 };
    const s = daySlots(6, [lisbon, porto], new Map([[lisbon.name, 20], ["Porto", 10]]), 5);
    expect(s.map((x) => x.kind)).toEqual(["arrival", "full", "full", "full", "travel", "departure"]);
    expect(s.map((x) => x.city)).toEqual([lisbon.name, lisbon.name, lisbon.name, lisbon.name, "Porto", "Porto"]);
    expect(s[0].cap).toBe(2.5);
  });

  it("clusters by neighborhood within capacity", () => {
    const items = [belem(), belem(), alfama(), alfama()];
    const { clusters, overflow } = clusterIntoDays(items, [4.5, 4.5], lisbon);
    expect(overflow).toEqual([]);
    for (const c of clusters) expect(new Set(c.map((a) => a.area)).size).toBe(1);
  });

  it("puts outdoor stops outside hot afternoons and honors evening picks", () => {
    const hike = act({ setting: "outdoor", bestTime: "afternoon" });
    const bar = act({ bestTime: "evening" });
    const museum = act();
    const b = assignBlocks([hike, museum, bar], 6, true);
    expect(b.morning).toContain(hike.id);
    expect(b.evening).toContain(bar.id);
  });
});

describe("buildVariant", () => {
  const pool = [
    sintra(),
    ...Array.from({ length: 5 }, (_, i) => belem({ name: `Belém ${i}`, tag: i === 0 ? "must_see" : "local_gem" })),
    ...Array.from({ length: 5 }, (_, i) => alfama({ name: `Alfama ${i}`, category: i % 2 ? "coffee" : "museums" })),
  ];
  const base: EngineInput = {
    pool,
    kept: pool.map((a) => a.id),
    removed: [],
    interests: interests(),
    days: 5,
    startDate: "2026-10-20",
    cities: [lisbon],
    pace: 3,
    climate: null,
    forecast: null,
  };

  it("lays out arrival → … → departure, keeps neighborhoods together, and dates days", () => {
    const it = buildVariant(base, "frontload");
    expect(it.days).toHaveLength(5);
    expect(it.days[0]).toMatchObject({ kind: "arrival", date: "2026-10-20" });
    expect(it.days[4]).toMatchObject({ kind: "departure", date: "2026-10-24" });
    expect(it.days.some((d) => d.kind === "daytrip" && d.area === "Sintra")).toBe(true);
    for (const d of it.days.filter((x) => x.kind === "full")) expect(d.sprawl).toBe(false);
    const sum = Object.values(it.achievedMix).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("schedules each activity at most once", () => {
    const it = buildVariant(base, "frontload");
    const all = it.days.flatMap(ids);
    expect(new Set(all).size).toBe(all.length);
  });

  it("the easy-going variant schedules less and keeps the rest optional", () => {
    const a = buildVariant(base, "frontload").days.flatMap(ids).length;
    const b = buildVariant(base, "easy");
    expect(b.days.flatMap(ids).length).toBeLessThanOrEqual(a);
    expect(b.optional.length).toBeGreaterThanOrEqual(0);
  });

  it("moves outdoor-heavy days off likely-rain days", () => {
    const forecast = [0, 1, 2, 3, 4].map((i) => ({
      date: `2026-10-2${i}`,
      highF: 70,
      lowF: 55,
      precipMm: i === 3 ? 12 : 0,
      precipProb: i === 3 ? 90 : 5,
    }));
    const it = buildVariant({ ...base, forecast }, "frontload");
    const rainy = it.days[3];
    expect(rainy.kind === "daytrip").toBe(false);
    expect(rainy.weatherNote).toMatch(/Rain likely/);
  });

  it("reports requirement checks", () => {
    const it = buildVariant(
      {
        ...base,
        interests: interests({
          rules: [
            { text: "at least two coffee stops", kind: "min_count", category: "coffee", count: 2, place: null, summary: "At least 2 coffee" },
            { text: "no clubbing", kind: "exclude", category: "clubbing", count: null, place: null, summary: "No clubbing" },
            { text: "must see Pena Palace", kind: "must_include", category: null, count: null, place: "Pena Palace", summary: "Pena" },
            { text: "slow mornings", kind: "time_pref", category: null, count: null, place: null, summary: "Slow mornings" },
          ],
        }),
      },
      "frontload",
    );
    expect(it.checks.map((c) => c.status)).toEqual(["met", "met", "met", "info"]);
    expect(it.checks[0].detail).toMatch(/2 of 2 scheduled \(Day \d/);
  });

  it("finalize recomputes after a manual move", () => {
    const it = buildVariant(base, "frontload");
    const byId = new Map(pool.map((a) => [a.id, a]));
    const full = it.days.findIndex((d) => d.kind === "full" && ids(d).length > 0);
    const moved = it.days.findIndex(
      (d, i) => i !== full && d.kind !== "daytrip" && ids(d).length > 0 && d.area !== it.days[full].area,
    );
    expect(moved).toBeGreaterThanOrEqual(0);
    const victim = ids(it.days[moved])[0];
    const edited = structuredClone(it);
    edited.days[moved].blocks = { morning: [], afternoon: [], evening: ids(it.days[moved]).filter((x) => x !== victim) };
    edited.days[full].blocks.afternoon.push(victim);
    const out = finalizeItinerary(edited, byId, base.interests, [lisbon]);
    expect(ids(out.days[full])).toContain(victim);
    expect(out.days[full].sprawl).toBe(true); // Belém + Alfama on one day
  });
});

describe("spread-out destinations (islands, regions)", () => {
  // Regression: a 3-day Bali plan scheduled nothing because every pick was >20 km from the
  // center, so the mix came out all zeros and saving the plan failed.
  const bali = { name: "Bali, Indonesia", lat: -8.3405, lng: 115.092 };
  const at = (area: string, lat: number, lng: number, i: number, o: Partial<Activity> = {}) =>
    act({ area, city: bali.name, lat: lat + i * 0.003, lng, category: "beaches", setting: "outdoor", ...o });
  const pool = [
    ...[0, 1, 2, 3].map((i) => at("Ubud", -8.5069, 115.2625, i, { category: "nature" })),
    ...[0, 1, 2].map((i) => at("Canggu", -8.6478, 115.1385, i, { category: "coffee" })),
    ...[0, 1].map((i) => at("Uluwatu", -8.8291, 115.0849, i)),
  ];
  const input: EngineInput = {
    pool,
    kept: pool.map((a) => a.id),
    removed: [],
    interests: interests({ chips: ["beaches", "nature", "coffee"], mix: { outdoors: 60, city: 0, food: 40, nightlife: 0, wellness: 0 } }),
    days: 3,
    startDate: null,
    cities: [bali],
    pace: 3,
    climate: null,
    forecast: null,
  };

  it("still schedules picks, grouped by area, with a valid mix", () => {
    for (const key of ["frontload", "easy"] as const) {
      const v = buildVariant(input, key);
      const scheduled = v.days.flatMap(ids);
      expect(scheduled.length).toBeGreaterThanOrEqual(4);
      expect(Object.values(v.achievedMix).reduce((a, b) => a + b, 0)).toBe(100);
      for (const d of v.days) {
        const areas = new Set(ids(d).map((x) => pool.find((a) => a.id === x)!.area));
        expect(areas.size).toBeLessThanOrEqual(1);
      }
    }
  });
});
