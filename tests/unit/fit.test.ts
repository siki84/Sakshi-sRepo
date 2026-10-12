import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDbForTests } from "@/lib/db";
import { buildCard, checkFitResearch, runFit } from "@/lib/fit";
import { normalizeUrl, type SearchResult } from "@/lib/ai/client";
import type { FitResearchAi } from "@/lib/ai/schemas";
import type { Profile } from "@/lib/schemas";
import { createTrip, getTrip } from "@/lib/repo";
import { withConfirmedDestination } from "@/lib/tripState";

const profile: Profile = {
  homeCity: "Chicago",
  passports: ["US", "IN"],
  weather: { idealMinF: 65, idealMaxF: 80, heat: "dislike", cold: "ok", humidity: "hate", rain: "dislike", notes: "" },
  travelers: { type: "partner", kidsAges: [], groupSize: 2 },
  pace: 3,
  units: "F",
};

const results = (...urls: string[]) =>
  new Map<string, SearchResult>(urls.map((u) => [normalizeUrl(u), { url: u, title: `T ${u}` }]));

const research = (over: Partial<FitResearchAi> = {}): FitResearchAi => ({
  vibe: "v",
  weatherVerdict: "w",
  season: { level: "peak", crowds: "high", prices: "high", summary: "s", sourceUrls: ["https://a.com/1"] },
  events: [
    { name: "Fest", kind: "festival", impact: "positive", when: "June", detail: "d", sourceUrls: ["https://a.com/1"] },
    { name: "Ghost", kind: "closure", impact: "negative", when: "June", detail: "d", sourceUrls: ["https://nope.com"] },
  ],
  visa: {
    perPassport: [
      { passport: "US", status: "visa_free", maxStay: "90 days", leadTime: null, notes: "", sourceUrls: ["https://gov.pt/v"] },
      { passport: "IN", status: "visa_required", maxStay: null, leadTime: "4–6 weeks", notes: "", sourceUrls: [] },
    ],
    officialUrl: "https://gov.pt/v",
    confidence: "high",
  },
  overall: { label: "good", summary: "o" },
  ...over,
});

const opts = { domestic: false, passports: ["US", "IN"], weatherLabel: "great" as const };

describe("checkFitResearch", () => {
  it("accepts well-sourced output", () => {
    expect(checkFitResearch(research(), { searchResults: results("https://a.com/1", "https://gov.pt/v") }, opts)).toEqual([]);
  });

  it("rejects invented sources", () => {
    const p = checkFitResearch(research(), { searchResults: results("https://other.com") }, opts);
    expect(p.join(" ")).toMatch(/season.sourceUrls/);
    expect(p.join(" ")).toMatch(/visa needs at least one source/);
  });

  it("requires one visa entry per passport, and none for domestic trips", () => {
    const sr = { searchResults: results("https://a.com/1", "https://gov.pt/v") };
    const missing = research({ visa: { ...research().visa!, perPassport: [research().visa!.perPassport[0]] } });
    expect(checkFitResearch(missing, sr, opts).join(" ")).toMatch(/exactly one entry for each of: IN, US/);
    expect(checkFitResearch(research(), sr, { ...opts, domestic: true }).join(" ")).toMatch(/visa must be null/);
  });

  it("won't let the overall verdict be rosier than the weather", () => {
    const sr = { searchResults: results("https://a.com/1", "https://gov.pt/v") };
    const p = checkFitResearch(research({ overall: { label: "great", summary: "" } }), sr, { ...opts, weatherLabel: "mixed" });
    expect(p.join(" ")).toMatch(/can't be better than the computed weather fit/);
  });
});

describe("buildCard", () => {
  const place = { query: "Lisbon", name: "Lisbon, Portugal", lat: 38.7, lng: -9.1, countryCode: "PT" };
  const card = buildCard(research(), results("https://a.com/1", "https://gov.pt/v"), { place, climate: null, weatherFit: null });

  it("drops events without a verified source", () => {
    expect(card.events.map((e) => e.name)).toEqual(["Fest"]);
  });

  it("picks the easiest passport and keeps only verified official URLs", () => {
    expect(card.visa?.best).toMatchObject({ passport: "US", status: "visa_free" });
    expect(card.visa?.officialUrl).toBe("https://gov.pt/v");
    expect(card.visa?.perPassport.find((p) => p.passport === "IN")?.sources).toEqual([]);
  });
});

describe("runFit (mock AI + mock weather)", () => {
  beforeEach(() => {
    process.env.MOCK_AI = "1";
    process.env.MOCK_EXTERNAL = "1";
    setDbForTests(openDb(":memory:"));
  });

  it("compares two candidates without alternatives when one fits", async () => {
    const r = await runFit(["Lisbon", "Seville"], { kind: "month", month: 5 }, profile, () => {});
    expect(r.candidates.map((c) => c.place.name)).toEqual(["Lisbon, Portugal", "Seville, Spain"]);
    expect(r.comparison).not.toBeNull();
    expect(r.alternatives).toEqual([]);
    for (const c of r.candidates) {
      expect(c.events.every((e) => e.sources.length > 0)).toBe(true);
      expect(c.visa?.perPassport).toHaveLength(2);
    }
  });

  it("suggests weather-checked alternatives when nothing fits", async () => {
    const r = await runFit(["Bangkok"], { kind: "month", month: 7 }, profile, () => {});
    expect(r.candidates[0].weatherFit?.label).toBe("poor");
    expect(r.candidates[0].overall.label).toBe("poor");
    expect(r.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(r.alternatives.length).toBeLessThanOrEqual(4);
    expect(r.alternatives.every((c) => ["great", "good"].includes(c.weatherFit!.label))).toBe(true);
  });

  it("reports places it can't find instead of failing the whole run", async () => {
    const r = await runFit(["Lisbon", "zzz-nowhere"], { kind: "month", month: 5 }, profile, () => {});
    expect(r.candidates).toHaveLength(1);
    expect(r.failures[0].error).toMatch(/Couldn't find/);
  });

  it("doesn't look for alternatives when nothing could be located", async () => {
    const r = await runFit(["zzz-nowhere"], { kind: "month", month: 5 }, profile, () => {});
    expect(r.candidates).toEqual([]);
    expect(r.alternatives).toEqual([]);
  });

  it("skips visa for domestic trips", async () => {
    const r = await runFit(["Seattle"], { kind: "month", month: 8 }, profile, () => {});
    expect(r.candidates[0].visa).toBeNull();
  });
});

describe("withConfirmedDestination", () => {
  beforeEach(() => setDbForTests(openDb(":memory:")));
  const place = { query: "Lisbon", name: "Lisbon, Portugal", lat: 38.7, lng: -9.1, countryCode: "PT" };
  const timing = { kind: "month" as const, month: 5 };
  const dest = { candidates: ["Lisbon"], timing, result: null };

  it("first confirmation unlocks interests", () => {
    const t = createTrip();
    expect(withConfirmedDestination(t, { place, stops: [], timing }, dest).phase).toBe(2);
  });

  it("changing the destination wipes research-based phases but keeps interests", () => {
    const t = { ...createTrip(), phase: 5 };
    t.state = {
      ...t.state,
      destination: { ...dest, confirmed: { place, stops: [], timing } },
      interests: { x: 1 },
      discover: { x: 1 },
      plan: { x: 1 },
    };
    const r = withConfirmedDestination(t, { place: { ...place, name: "Porto, Portugal" }, stops: [], timing }, dest);
    expect(r.phase).toBe(3);
    expect(r.state.discover).toBeUndefined();
    expect(r.state.plan).toBeUndefined();
    expect("interests" in r.state).toBe(false);
    expect(getTrip(t.id)).not.toBeNull();
  });

  it("re-confirming the same destination keeps progress", () => {
    const t = { ...createTrip(), phase: 4 };
    t.state = { ...t.state, destination: { ...dest, confirmed: { place, stops: [], timing } } };
    expect(withConfirmedDestination(t, { place, stops: [], timing }, dest).phase).toBe(4);
  });
});
