import { beforeEach, describe, expect, it } from "vitest";
import {
  activeGroups,
  customKey,
  initialMix,
  normalize,
  reconcileMix,
  setGroupShare,
  type Group,
  type Mix,
} from "@/lib/interests";
import { applyRules, checkRules, interpretRequirements } from "@/lib/requirements";
import { withInterests } from "@/lib/tripState";
import { createTrip } from "@/lib/repo";
import { openDb, setDbForTests } from "@/lib/db";
import type { InterestsState } from "@/lib/schemas";

const sum = (m: Mix) => Object.values(m).reduce((a, b) => a + b, 0);

describe("mix math", () => {
  it("normalizes to integers that sum to exactly 100", () => {
    const m = normalize({ outdoors: 1, city: 1, food: 1 });
    expect(sum(m)).toBe(100);
    expect([m.outdoors, m.city, m.food].sort()).toEqual([33, 33, 34]);
    expect(m.nightlife).toBe(0);
  });

  it("starts proportional to chips picked per group, ignoring modifiers", () => {
    const m = initialMix(["hiking", "beaches", "museums", "coffee", "kid_friendly"]);
    expect(m).toMatchObject({ outdoors: 50, city: 25, food: 25, nightlife: 0 });
    expect(activeGroups(["kid_friendly"])).toEqual([]);
  });

  it("moving a slider pins it and rebalances the others proportionally", () => {
    const groups: Group[] = ["outdoors", "city", "food"];
    const m = setGroupShare({ outdoors: 40, city: 30, food: 30, nightlife: 0, wellness: 0 }, groups, "outdoors", 70);
    expect(m.outdoors).toBe(70);
    expect(m.city).toBe(15);
    expect(m.food).toBe(15);
    expect(sum(m)).toBe(100);
  });

  it("keeps the total at 100 for awkward values and extremes", () => {
    const groups: Group[] = ["outdoors", "city", "food"];
    let m: Mix = { outdoors: 34, city: 33, food: 33, nightlife: 0, wellness: 0 };
    for (const v of [0, 5, 35, 55, 95, 100]) {
      m = setGroupShare(m, groups, "city", v);
      expect(m.city).toBe(v);
      expect(sum(m)).toBe(100);
    }
  });

  it("revives zeroed groups equally when the moved one comes down", () => {
    const groups: Group[] = ["outdoors", "city"];
    const m = setGroupShare({ outdoors: 100, city: 0, food: 0, nightlife: 0, wellness: 0 }, groups, "outdoors", 60);
    expect(m).toMatchObject({ outdoors: 60, city: 40 });
  });

  it("reconciles when groups are added or removed", () => {
    const base: Mix = { outdoors: 60, city: 40, food: 0, nightlife: 0, wellness: 0 };
    const added = reconcileMix(base, ["outdoors", "city", "food"]);
    expect(sum(added)).toBe(100);
    expect(added.food).toBeGreaterThan(0);
    expect(added.outdoors).toBeGreaterThan(added.city);
    expect(reconcileMix(base, ["city"])).toMatchObject({ city: 100, outdoors: 0 });
  });

  it("makes safe keys for custom interests", () => {
    expect(customKey("Vintage shops!")).toBe("custom_vintage_shops");
  });
});

describe("requirements", () => {
  const keys = new Set(["hiking", "clubbing", "great_dinners"]);

  it("checks rule count, categories, and counts", () => {
    const p = checkRules(
      [
        { text: "a", kind: "min_count", category: "yoga", count: null, place: null, summary: "" },
        { text: "b", kind: "exclude", category: null, count: null, place: null, summary: "" },
      ],
      ["a", "b", "c"],
      keys,
    );
    expect(p.join(" ")).toMatch(/exactly 3 rules/);
    expect(p.join(" ")).toMatch(/"yoga" is not one of the allowed keys/);
    expect(p.join(" ")).toMatch(/needs a count/);
    expect(p.join(" ")).toMatch(/rules\[1\] \(exclude\) needs a category or a place/);
  });

  it("adds chips the traveler requires and removes ones they excluded", () => {
    const r = applyRules(
      ["clubbing", "museums"],
      [
        { text: "at least two hikes", kind: "min_count", category: "hiking", count: 2, place: null, summary: "" },
        { text: "no clubbing", kind: "exclude", category: "clubbing", count: null, place: null, summary: "" },
      ],
    );
    expect(r.chips.sort()).toEqual(["hiking", "museums"]);
    expect(r.notices[0]).toMatch(/Added “Hiking”/);
    expect(r.notices[1]).toMatch(/Removed “Clubbing”/);
  });

  it("interprets requirements (mock AI) and keeps the original wording", async () => {
    process.env.MOCK_AI = "1";
    setDbForTests(openDb(":memory:"));
    const rules = await interpretRequirements(["At least two hikes", "No clubbing", "Sunset somewhere pretty"], [], {
      destination: "Lisbon",
    });
    expect(rules.map((r) => [r.kind, r.category, r.count])).toEqual([
      ["min_count", "hiking", 2],
      ["exclude", "clubbing", null],
      ["other", null, null],
    ]);
    expect(rules[0].text).toBe("At least two hikes");
  });
});

describe("withInterests", () => {
  beforeEach(() => setDbForTests(openDb(":memory:")));
  const interests = (over: Partial<InterestsState> = {}): InterestsState => ({
    chips: ["hiking", "coffee"],
    custom: [],
    mix: { outdoors: 50, city: 0, food: 50, nightlife: 0, wellness: 0 },
    requirements: [],
    rules: [],
    notices: [],
    ...over,
  });

  it("unlocks discovery the first time", () => {
    expect(withInterests({ ...createTrip(), phase: 2 }, interests()).phase).toBe(3);
  });

  it("a new mix re-ranks discovery (not stale) but invalidates length and plan", () => {
    const t = { ...createTrip(), phase: 5 };
    t.state = { ...t.state, interests: interests(), discover: { pool: [], kept: [], removed: [], researchedFor: { place: "", stops: [], batches: {} }, updatedAt: "" }, length: {} as never, plan: {} };
    const r = withInterests(t, interests({ mix: { outdoors: 70, city: 0, food: 30, nightlife: 0, wellness: 0 } }));
    expect(r.state.stale?.sort()).toEqual(["length", "plan"]);
    expect(r.phase).toBe(5);
  });

  it("a different set of interests also makes discovery stale", () => {
    const t = { ...createTrip(), phase: 5 };
    t.state = { ...t.state, interests: interests(), discover: { pool: [], kept: [], removed: [], researchedFor: { place: "", stops: [], batches: {} }, updatedAt: "" }, length: {} as never, plan: {} };
    const r = withInterests(t, interests({ chips: ["hiking", "coffee", "bars"] }));
    expect(r.state.stale?.sort()).toEqual(["discover", "length", "plan"]);
  });

  it("saving unchanged interests changes nothing", () => {
    const t = { ...createTrip(), phase: 5 };
    t.state = { ...t.state, interests: interests(), discover: { pool: [], kept: [], removed: [], researchedFor: { place: "", stops: [], batches: {} }, updatedAt: "" }, length: {} as never, plan: {} };
    expect(withInterests(t, interests()).state.stale).toEqual([]);
  });
});
