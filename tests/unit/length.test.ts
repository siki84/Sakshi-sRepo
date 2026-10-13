import { beforeEach, describe, expect, it } from "vitest";
import { closestOption, dayTripGroups, essentials, estimate, lengthOptions, selectionFor } from "@/lib/length";
import { computeLength } from "@/lib/tripLength";
import { planBatches, runDiscovery } from "@/lib/discover";
import { withConfirmedDestination } from "@/lib/tripState";
import { approxDaysOf, describeLength } from "@/lib/timing";
import { openDb, setDbForTests } from "@/lib/db";
import { createTrip } from "@/lib/repo";
import type { Activity, DiscoverState, InterestsState, Profile, Trip } from "@/lib/schemas";

const lisbon = { query: "Lisbon", name: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393, countryCode: "PT" };
const centers = new Map([[lisbon.name, lisbon]]);
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
const sintra = (over: Partial<Activity> = {}) => act({ name: "Pena Palace", lat: 38.7876, lng: -9.3906, tag: "must_see", ...over });

const interests = (over: Partial<InterestsState> = {}): InterestsState => ({
  chips: ["museums", "hiking"],
  custom: [],
  mix: { outdoors: 50, city: 50, food: 0, nightlife: 0, wellness: 0 },
  requirements: [],
  rules: [],
  notices: [],
  ...over,
});

describe("estimate", () => {
  it("divides activity hours by the pace's comfortable hours/day, plus an arrival buffer", () => {
    const items = Array.from({ length: 8 }, () => act({ durationHrs: 2 })); // 16h
    const relaxed = estimate(items, centers, lisbon.name, 1); // 3.5h/day → 5 days + 1
    const packed = estimate(items, centers, lisbon.name, 5); // 8h/day → 2 days (+0, too short for buffer)
    expect(relaxed).toMatchObject({ days: 6, breakdown: { cityDays: 5, arrivalBuffer: 1 } });
    expect(packed).toMatchObject({ days: 2, breakdown: { cityDays: 2, arrivalBuffer: 0 } });
  });

  it("counts far-away spots as day trips, grouping ones near each other", () => {
    const trips = dayTripGroups([sintra(), sintra({ name: "Quinta da Regaleira", lat: 38.796, lng: -9.396 }), act()], centers);
    expect(trips).toHaveLength(1);
    const e = estimate([act(), act(), sintra()], centers, lisbon.name, 3);
    expect(e.breakdown).toMatchObject({ dayTrips: 1, cityDays: 1 });
  });

  it("adds half a travel day per extra stop", () => {
    const porto = { lat: 41.15, lng: -8.61 };
    const c = new Map([...centers, ["Porto", porto]]);
    const e = estimate([act(), act({ city: "Porto", lat: 41.15, lng: -8.61 })], c, lisbon.name, 3);
    expect(e.breakdown).toMatchObject({ cityDays: 2, travelDays: 1 });
  });
});

describe("options", () => {
  it("are strictly increasing and the minimum keeps must-sees and required items", () => {
    const items = [
      act({ tag: "must_see", name: "Belém Tower" }),
      act({ category: "hiking", name: "Trail A", durationHrs: 3 }),
      act({ category: "hiking", name: "Trail B", durationHrs: 3 }),
      ...Array.from({ length: 8 }, () => act()),
    ];
    const i = interests({ rules: [{ text: "at least two hikes", kind: "min_count", category: "hiking", count: 2, place: null, summary: "" }] });
    expect(essentials(items, i).map((a) => a.name)).toEqual(["Belém Tower", "Trail A", "Trail B"]);
    const o = lengthOptions(items, [act(), act()], i, centers, lisbon.name, 3);
    expect(o.min.days).toBeLessThan(o.ideal.days);
    expect(o.ideal.days).toBeLessThan(o.generous.days);
    expect(o.generous.itemIds.length).toBeGreaterThan(o.ideal.itemIds.length);
    expect(closestOption(o, o.generous.days + 3)).toBe("generous");
    expect(closestOption(o, null)).toBeNull();
  });

  it("tops up a short kept list with top-ranked ideas", () => {
    const pool = Array.from({ length: 20 }, () => act());
    const d: DiscoverState = { pool, kept: [pool[5].id], removed: [], researchedFor: { place: "", stops: [], batches: {} }, updatedAt: "" };
    const s = selectionFor(d, interests(), { approxDays: 3, pace: 3 });
    expect(s.usedTopRanked).toBe(true);
    expect(s.items.map((a) => a.id)).toContain(pool[5].id);
    expect(s.items.length).toBeGreaterThan(1);
    const all = { ...d, kept: pool.slice(0, 6).map((a) => a.id) };
    expect(selectionFor(all, interests(), { approxDays: 3, pace: 3 })).toMatchObject({ usedTopRanked: false });
  });
});

describe("rough trip length", () => {
  beforeEach(() => setDbForTests(openDb(":memory:")));

  it("comes from exact dates or the traveler's guess", () => {
    expect(approxDaysOf({ kind: "dates", start: "2026-11-02", end: "2026-11-06" })).toBe(5);
    expect(describeLength({ kind: "month", month: 5, approxDays: 7 })).toBe("about 7 days");
    expect(describeLength({ kind: "month", month: 5, approxDays: null })).toBe("length not decided yet");
  });

  it("scales how much discovery researches", () => {
    const short = planBatches(interests(), lisbon.name, [], 3);
    const long = planBatches(interests(), lisbon.name, [], 14);
    expect(long.reduce((s, b) => s + b.count, 0)).toBeGreaterThan(short.reduce((s, b) => s + b.count, 0));
  });

  it("changing only the rough length keeps research but flags length and plan", () => {
    const place = lisbon;
    const t: Trip = { ...createTrip(), phase: 5 };
    t.state = {
      ...t.state,
      destination: { candidates: [], timing: { kind: "month", month: 5, approxDays: 5 }, travelDocs: null, result: null, confirmed: { place, stops: [], timing: { kind: "month", month: 5, approxDays: 5 } } },
      discover: { pool: [], kept: [], removed: [], researchedFor: { place: "", stops: [], batches: {} }, updatedAt: "" },
      length: {} as never,
    };
    const r = withConfirmedDestination(t, { place, stops: [], timing: { kind: "month", month: 5, approxDays: 9 } }, { candidates: [], timing: { kind: "month", month: 5, approxDays: 9 }, travelDocs: null, result: null });
    expect(r.state.discover).toBeUndefined(); // not wiped (key absent from patch)
    expect("discover" in r.state).toBe(false);
    expect(r.state.stale).toEqual(["length"]);
    expect(r.phase).toBe(5);
  });
});

describe("computeLength (mock AI)", () => {
  beforeEach(() => {
    process.env.MOCK_AI = "1";
    process.env.MOCK_EXTERNAL = "1";
    setDbForTests(openDb(":memory:"));
  });

  it("produces options plus an explanation that mentions the rough length", async () => {
    const profile: Profile = {
      homeCity: "Chicago",
      passports: ["US"],
      weather: { idealMinF: 65, idealMaxF: 80, heat: "dislike", cold: "ok", humidity: "hate", rain: "dislike", notes: "" },
      travelers: { type: "partner", kidsAges: [], groupSize: 2 },
      pace: 3,
      units: "F",
      travelDocs: { residencePermits: [], visasHeld: [], restrictions: "", avoidAdvanceVisa: false },
    };
    const timing = { kind: "month" as const, month: 5, approxDays: 5 };
    const i = interests();
    const discover = await runDiscovery({ place: lisbon, stops: [], timing, climate: null, profile, interests: i }, () => {});
    const t: Trip = { ...createTrip(), phase: 4 };
    t.state = {
      ...t.state,
      destination: { candidates: [], timing, travelDocs: null, result: null, confirmed: { place: lisbon, stops: [], timing } },
      interests: i,
      discover: { ...discover, kept: discover.pool.slice(0, 8).map((a) => a.id) },
    };
    const L = await computeLength(t, profile);
    expect(L.options.min.days).toBeLessThan(L.options.ideal.days);
    expect(L.advice.headline).toContain(String(L.options.ideal.days));
    expect(L.advice.approxNote).toMatch(/about 5 days/);
    expect(L.usedTopRanked).toBe(false);
    expect(L.selectionIds).toHaveLength(8);
  });
});

describe("day-trip distance", () => {
  it("is 20 km for compact cities and relative for spread-out regions", async () => {
    const { dayTripThresholdKm } = await import("@/lib/length");
    const city = [act(), act(), sintra()];
    expect(dayTripThresholdKm(city, lisbon)).toBe(20);
    const bali = { lat: -8.3405, lng: 115.092 };
    const region = [
      act({ lat: -8.5069, lng: 115.2625 }), // Ubud ~26 km
      act({ lat: -8.6478, lng: 115.1385 }), // Canggu ~34 km
      act({ lat: -8.8291, lng: 115.0849 }), // Uluwatu ~54 km
    ];
    expect(dayTripThresholdKm(region, bali)).toBeGreaterThan(45);
  });
});
