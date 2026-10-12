import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDbForTests } from "@/lib/db";
import { checkBatch, dedupe, moreLikeThis, normalizeName, planBatches, runDiscovery, toActivities } from "@/lib/discover";
import { hoursMix, rankActivities } from "@/lib/rank";
import { normalizeUrl, type SearchResult } from "@/lib/ai/client";
import type { Activity, InterestsState, Profile } from "@/lib/schemas";

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

const interests = (over: Partial<InterestsState> = {}): InterestsState => ({
  chips: ["hiking", "beaches", "museums", "coffee"],
  custom: [],
  mix: { outdoors: 50, city: 25, food: 25, nightlife: 0, wellness: 0 },
  requirements: [],
  rules: [],
  notices: [],
  ...over,
});

let n = 0;
const act = (over: Partial<Activity> = {}): Activity => ({
  id: `a${++n}`,
  name: `Thing ${n}`,
  category: "hiking",
  tag: "local_gem",
  why: "",
  area: "Alfama",
  city: "Lisbon, Portugal",
  durationHrs: 2,
  bestTime: "any",
  setting: "outdoor",
  kidFriendly: true,
  buzz: 3,
  lat: 38.72,
  lng: -9.14,
  locationVerified: true,
  sources: [{ url: "https://x.com/1", title: "" }],
  similarTo: null,
  batch: "outdoors",
  ...over,
});

describe("dedupe", () => {
  it("merges same-name items (accents/articles ignored) and combines sources", () => {
    const out = dedupe([
      act({ name: "The Miradouro da Graça", sources: [{ url: "https://a.com", title: "" }] }),
      act({ name: "Miradouro Graca", tag: "must_see", buzz: 5, sources: [{ url: "https://b.com", title: "" }] }),
    ]);
    expect(normalizeName("The Miradouro da Graça")).toBe("miradouro graca");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tag: "must_see", buzz: 5 });
    expect(out[0].sources.map((s) => s.url)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("keeps similarly named places that are far apart", () => {
    expect(dedupe([act({ name: "Time Out Market" }), act({ name: "Time Out Market Porto", lat: 41.15, lng: -8.6 })])).toHaveLength(2);
  });
});

describe("planBatches", () => {
  it("researches must-sees, each active group, and each extra stop", () => {
    const b = planBatches(interests({ chips: ["hiking", "beaches", "coffee", "kid_friendly"] }), "Lisbon, Portugal", ["Sintra"]);
    expect(b.map((x) => x.key)).toEqual(["must_see", "outdoors", "food", "stop:Sintra"]);
    expect(b.find((x) => x.key === "outdoors")?.chips).toEqual(["beaches", "hiking"]);
    expect(b.find((x) => x.key === "must_see")?.chips).not.toContain("kid_friendly");
  });
});

describe("checkBatch / toActivities", () => {
  const search = new Map<string, SearchResult>([[normalizeUrl("https://reddit.com/r/lisbon/1"), { url: "https://reddit.com/r/lisbon/1", title: "t" }]]);
  const raw = (over: Record<string, unknown> = {}) => ({
    name: "Thing",
    category: "hiking",
    tag: "local_gem" as const,
    why: "",
    area: "Alfama",
    durationHrs: 2,
    bestTime: "any" as const,
    setting: "outdoor" as const,
    kidFriendly: true,
    buzz: 4,
    lat: 38.72,
    lng: -9.14,
    sourceUrls: ["https://reddit.com/r/lisbon/1"],
    ...over,
  });

  it("flags bad categories, unsourced and far-away items", () => {
    const p = checkBatch(
      { activities: [raw({ category: "yoga" }), raw({ sourceUrls: [] }), raw({ sourceUrls: [] }), raw({ lat: 0, lng: 0 }), raw({ lat: 1, lng: 1 })] },
      { searchResults: search },
      { allowed: new Set(["hiking"]), center: lisbon, min: 3 },
    );
    expect(p.join(" ")).toMatch(/invalid category for: Thing/);
    expect(p.join(" ")).toMatch(/too many items without a source/);
    expect(p.join(" ")).toMatch(/far from the city/);
  });

  it("drops unsourced, far, and excluded items and clamps numbers", () => {
    const out = toActivities(
      [raw({ name: "Ok", durationHrs: 30, buzz: 9 }), raw({ name: "No src", sourceUrls: ["https://nope"] }), raw({ name: "Far", lat: 0 }), raw({ name: "Club X", category: "clubbing" })],
      search,
      {
        city: "Lisbon, Portugal",
        center: lisbon,
        batch: "outdoors",
        interests: interests({ rules: [{ text: "no clubbing", kind: "exclude", category: "clubbing", count: null, place: null, summary: "" }] }),
      },
    );
    expect(out.map((a) => a.name)).toEqual(["Ok"]);
    expect(out[0]).toMatchObject({ durationHrs: 12, buzz: 5, locationVerified: false });
  });
});

describe("rankActivities", () => {
  it("interleaves groups roughly in proportion to the mix", () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => act({ category: "hiking", buzz: 5 - (i % 5) })),
      ...Array.from({ length: 10 }, () => act({ category: "museums" })),
      ...Array.from({ length: 10 }, () => act({ category: "coffee" })),
    ];
    const top8 = rankActivities(pool, interests()).slice(0, 8);
    const count = (c: string) => top8.filter((a) => a.category === c).length;
    expect(count("hiking")).toBe(4);
    expect(count("museums")).toBe(2);
    expect(count("coffee")).toBe(2);
  });

  it("puts must-include places first and leaves out removed and excluded items", () => {
    const belem = act({ name: "Belém Tower", category: "museums", buzz: 1 });
    const club = act({ category: "clubbing" });
    const gone = act();
    const out = rankActivities(
      [act(), act(), belem, club, gone],
      interests({
        rules: [
          { text: "must see Belem Tower", kind: "must_include", category: null, count: null, place: "Belém Tower", summary: "" },
          { text: "no clubbing", kind: "exclude", category: "clubbing", count: null, place: null, summary: "" },
        ],
      }),
      [gone.id],
    );
    expect(out[0].id).toBe(belem.id);
    expect(out.map((a) => a.id)).not.toContain(club.id);
    expect(out.map((a) => a.id)).not.toContain(gone.id);
  });

  it("demotes non-kid-friendly items when traveling with kids", () => {
    const bar = act({ name: "Late bar crawl", kidFriendly: false, buzz: 5 });
    const park = act({ name: "Playground park", kidFriendly: true, buzz: 4 });
    const out = rankActivities([bar, park], interests({ chips: ["hiking", "kid_friendly"], mix: { outdoors: 100, city: 0, food: 0, nightlife: 0, wellness: 0 } }));
    expect(out[0].id).toBe(park.id);
  });

  it("computes the kept mix by hours", () => {
    const m = hoursMix([act({ category: "hiking", durationHrs: 3 }), act({ category: "coffee", durationHrs: 1 })], []);
    expect(m).toMatchObject({ outdoors: 75, food: 25, city: 0 });
  });
});

describe("runDiscovery (mock AI + mock geocoder)", () => {
  beforeEach(() => {
    process.env.MOCK_AI = "1";
    process.env.MOCK_EXTERNAL = "1";
    setDbForTests(openDb(":memory:"));
  });

  const input = (i = interests()) => ({ place: lisbon, stops: [], timing: { kind: "month" as const, month: 5, approxDays: null }, climate: null, profile, interests: i });

  it("builds a sourced, deduped, location-checked pool", async () => {
    const s = await runDiscovery(input(), () => {});
    expect(s.pool.length).toBeGreaterThan(20);
    expect(s.pool.every((a) => a.sources.length > 0)).toBe(true);
    expect(s.pool.some((a) => a.name.includes("rumor"))).toBe(false); // unsourced dropped
    expect(s.pool.some((a) => !a.locationVerified)).toBe(true); // approximate ones flagged
    expect(new Set(s.pool.map((a) => a.id)).size).toBe(s.pool.length);
    expect(Object.keys(s.researchedFor.batches).sort()).toEqual(["city", "food", "must_see", "outdoors"]);
  });

  it("refreshes only batches whose interests changed and keeps choices", async () => {
    const first = await runDiscovery(input(), () => {});
    const keptId = first.pool.find((a) => a.category === "hiking")!.id;
    const previous = { ...first, kept: [keptId] };
    const msgs: string[] = [];
    const next = await runDiscovery(
      { ...input(interests({ chips: ["hiking", "beaches", "museums", "coffee", "bars"], mix: { outdoors: 40, city: 20, food: 20, nightlife: 20, wellness: 0 } })), previous },
      (p) => p.type === "status" && msgs.push(p.message),
    );
    const researched = msgs.filter((m) => m.startsWith("Researching"));
    // must-sees (chip set changed) + nightlife (new); outdoors/city/food unchanged.
    expect(researched).toHaveLength(2);
    expect(researched.join(" ")).toMatch(/nightlife/);
    expect(next.kept).toEqual([keptId]);
    expect(next.pool.some((a) => a.category === "bars")).toBe(true);
  });

  it("finds more like a seed and tags them", async () => {
    const s = await runDiscovery(input(), () => {});
    const added = await moreLikeThis(s.pool[0], s, input(), () => {});
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((a) => a.similarTo === s.pool[0].id)).toBe(true);
  });
});
