import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDbForTests } from "@/lib/db";
import { createTrip } from "@/lib/repo";
import { runDiscovery } from "@/lib/discover";
import { computeLength } from "@/lib/tripLength";
import { generatePlan } from "@/lib/plan";
import { checkOps, interpretChat, type RefineOps } from "@/lib/plan/ai";
import { applyOps, editWarnings, lightenDay, placeActivity, swapDays } from "@/lib/plan/edit";
import type { Activity, InterestsState, Itinerary, Profile, Trip } from "@/lib/schemas";

const lisbon = { query: "Lisbon", name: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393, countryCode: "PT" };
const profile: Profile = {
  homeCity: "Chicago",
  passports: ["US"],
  weather: { idealMinF: 65, idealMaxF: 80, heat: "dislike", cold: "ok", humidity: "hate", rain: "dislike", notes: "" },
  travelers: { type: "partner", kidsAges: [], groupSize: 2 },
  pace: 3,
  units: "F",
  travelDocs: { residencePermits: [], visasHeld: [], restrictions: "", avoidAdvanceVisa: false },
};
const interests: InterestsState = {
  chips: ["hiking", "museums", "coffee"],
  custom: [],
  mix: { outdoors: 40, city: 30, food: 30, nightlife: 0, wellness: 0 },
  requirements: ["at least two coffee stops"],
  rules: [{ text: "at least two coffee stops", kind: "min_count", category: "coffee", count: 2, place: null, summary: "At least 2 coffee" }],
  notices: [],
};
const ids = (d: Itinerary["days"][number]) => [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening];

async function readyTrip(days = 5): Promise<Trip> {
  const timing = { kind: "month" as const, month: 5, approxDays: days };
  const discover = await runDiscovery({ place: lisbon, stops: [], timing, climate: null, profile, interests }, () => {});
  const t: Trip = { ...createTrip(), phase: 5 };
  t.state = {
    ...t.state,
    destination: { candidates: [], timing, travelDocs: null, result: null, confirmed: { place: lisbon, stops: [], timing } },
    interests,
    discover: { ...discover, kept: discover.pool.slice(0, 12).map((a) => a.id) },
  };
  const length = await computeLength(t, profile);
  t.state.length = { ...length, chosenDays: days, startDate: null };
  return t;
}

beforeEach(() => {
  process.env.MOCK_AI = "1";
  process.env.MOCK_EXTERNAL = "1";
  setDbForTests(openDb(":memory:"));
});

describe("generatePlan (mock AI)", () => {
  it("builds two titled variants, checks, and a sourced place to stay", async () => {
    const t = await readyTrip(5);
    const plan = await generatePlan(t, profile, () => {});
    expect(plan.variants.map((v) => v.key)).toEqual(["frontload", "easy"]);
    for (const v of plan.variants) {
      expect(v.days).toHaveLength(5);
      expect(v.tagline).not.toBe("");
      expect(v.days.every((d) => d.title)).toBe(true);
      expect(v.checks).toHaveLength(1);
      const all = v.days.flatMap(ids);
      expect(new Set(all).size).toBe(all.length);
    }
    expect(plan.stays.length).toBe(2);
    expect(plan.stays.every((s) => s.sources.length > 0 && s.avgKmToDays >= 0)).toBe(true);
    expect(plan.chosen).toBeNull();
  });
});

describe("edits", () => {
  it("validates chat ops against real ids and days", async () => {
    const t = await readyTrip(4);
    const plan = await generatePlan(t, profile, () => {});
    const it = plan.variants[0];
    const byId = new Map(t.state.discover!.pool.map((a) => [a.id, a]));
    const bad: RefineOps = {
      reply: "",
      ops: [
        { op: "move", activityId: "nope", day: null, toDay: 9, block: null },
        { op: "swap_days", activityId: null, day: 1, toDay: null, block: null },
      ],
      dayTitles: [{ n: 42, title: "", summary: "" }],
    };
    const p = checkOps(bad, it, byId);
    expect(p.join(" ")).toMatch(/activityId must be one of/);
    expect(p.join(" ")).toMatch(/toDay must be a valid day/);
    expect(p.join(" ")).toMatch(/swap_days needs day and toDay/);
    expect(p.join(" ")).toMatch(/no day 42/);
  });

  it("moves, swaps, and lightens deterministically", async () => {
    const t = await readyTrip(4);
    const plan = await generatePlan(t, profile, () => {});
    const it = plan.variants[0];
    const byId = new Map<string, Activity>(t.state.discover!.pool.map((a) => [a.id, a]));
    const fromDay = it.days.find((d) => ids(d).length >= 2)!;
    const id = ids(fromDay)[0];
    const toDay = it.days.find((d) => d.n !== fromDay.n)!.n;
    const moved = placeActivity(it, id, toDay, "evening", byId);
    expect(ids(moved.days.find((d) => d.n === toDay)!)).toContain(id);
    expect(ids(moved.days.find((d) => d.n === fromDay.n)!)).not.toContain(id);

    const swapped = swapDays(it, 1, 2);
    expect(ids(swapped.days[0])).toEqual(ids(it.days[1]));

    const before = ids(fromDay).length;
    const light = lightenDay(it, fromDay.n, byId, new Set());
    expect(ids(light.days.find((d) => d.n === fromDay.n)!).length).toBeLessThan(before);
    expect(light.optional.length).toBeGreaterThan(it.optional.length - 1);
  });

  it("chat: interprets, applies, re-checks, and warns when a requirement breaks", async () => {
    const t = await readyTrip(4);
    const plan = await generatePlan(t, profile, () => {});
    const it = plan.variants[0];
    const byId = new Map<string, Activity>(t.state.discover!.pool.map((a) => [a.id, a]));
    const cities = [{ name: lisbon.name, lat: lisbon.lat, lng: lisbon.lng }];
    const ops = await interpretChat("swap day 2 and 3", it, byId, [], { profile, interests, history: [] });
    expect(ops.ops[0]).toMatchObject({ op: "swap_days", day: 2, toDay: 3 });
    const { itinerary } = applyOps(it, ops, { byId, interests, cities, kept: new Set() });
    expect(ids(itinerary.days[1]).sort()).toEqual(ids(it.days[2]).sort());

    // Remove every coffee stop → the "at least two coffee stops" check flips and we warn.
    const coffee = it.days.flatMap(ids).filter((x) => byId.get(x)!.category === "coffee");
    const removeAll: RefineOps = {
      reply: "ok",
      ops: coffee.map((x) => ({ op: "remove" as const, activityId: x, day: null, toDay: null, block: null })),
      dayTitles: [],
    };
    const after = applyOps(it, removeAll, { byId, interests, cities, kept: new Set() }).itinerary;
    if (it.checks[0].status === "met") {
      expect(after.checks[0].status).toBe("not_met");
      expect(editWarnings(it, after).join(" ")).toMatch(/no longer met/);
    }
  });
});
