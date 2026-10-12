import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDbForTests } from "@/lib/db";
import { buildCard, checkFitResearch, runFit, type FitCheckOpts } from "@/lib/fit";
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
  travelDocs: { residencePermits: [], visasHeld: [], restrictions: "", avoidAdvanceVisa: false },
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
    otherDocuments: [],
    officialUrl: "https://gov.pt/v",
    confidence: "high",
  },
  restrictions: [],
  overall: { label: "good", summary: "o" },
  ...over,
});

const opts: FitCheckOpts = {
  domestic: false,
  passports: ["US", "IN"],
  weatherLabel: "great",
  docCount: 0,
  hasRestrictions: false,
  avoidAdvanceVisa: false,
};

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

describe("travel documents and restrictions", () => {
  const sr = { searchResults: results("https://a.com/1", "https://gov.pt/v") };
  const usVisa = {
    document: "US tourist visa",
    effect: "grants_entry" as const,
    status: "visa_free" as const,
    notes: "valid multiple-entry US visa accepted",
    sourceUrls: ["https://gov.pt/v"],
  };
  const indiaOnly = research({
    visa: {
      perPassport: [{ passport: "IN", status: "visa_required", maxStay: null, leadTime: "4 weeks", notes: "", sourceUrls: ["https://gov.pt/v"] }],
      otherDocuments: [],
      officialUrl: null,
      confidence: "medium",
    },
  });
  const inOpts = { ...opts, passports: ["IN"] };

  it("requires one answer per listed document", () => {
    expect(checkFitResearch(indiaOnly, sr, { ...inOpts, docCount: 1 }).join(" ")).toMatch(/otherDocuments must have exactly 1/);
    const ok = { ...indiaOnly, visa: { ...indiaOnly.visa!, otherDocuments: [usVisa] } };
    expect(checkFitResearch(ok, sr, { ...inOpts, docCount: 1 })).toEqual([]);
  });

  it("requires answers to the traveler's stated restrictions", () => {
    expect(checkFitResearch(research(), sr, { ...opts, hasRestrictions: true }).join(" ")).toMatch(/restrictions must address/);
  });

  it("a blocker forces a poor verdict", () => {
    const d = research({ restrictions: [{ concern: "overstay", impact: "blocker", notes: "", sourceUrls: [] }] });
    expect(checkFitResearch(d, sr, { ...opts, hasRestrictions: true }).join(" ")).toMatch(/blocker/);
  });

  it("'no advance visa' preference forces poor when only an advance visa works", () => {
    expect(checkFitResearch(indiaOnly, sr, { ...inOpts, avoidAdvanceVisa: true }).join(" ")).toMatch(/no visa applied for in advance/);
    // …but a document that grants entry rescues it.
    const ok = { ...indiaOnly, visa: { ...indiaOnly.visa!, otherDocuments: [usVisa] } };
    expect(checkFitResearch(ok, sr, { ...inOpts, docCount: 1, avoidAdvanceVisa: true })).toEqual([]);
  });

  it("uses a sourced document as the easiest entry route", () => {
    const place = { query: "x", name: "X", lat: 0, lng: 0, countryCode: "MX" };
    const ok = { ...indiaOnly, visa: { ...indiaOnly.visa!, otherDocuments: [usVisa] } };
    const card = buildCard(ok, sr.searchResults, { place, climate: null, weatherFit: null });
    expect(card.visa?.best).toMatchObject({ status: "visa_free", via: "US tourist visa" });
  });

  it("ignores an unsourced document claim and marks it unverified", () => {
    const place = { query: "x", name: "X", lat: 0, lng: 0, countryCode: "MX" };
    const d = { ...indiaOnly, visa: { ...indiaOnly.visa!, otherDocuments: [{ ...usVisa, sourceUrls: ["https://made.up"] }] } };
    const card = buildCard(d, sr.searchResults, { place, climate: null, weatherFit: null });
    expect(card.visa?.best).toMatchObject({ status: "visa_required", via: null });
    expect(card.visa?.otherDocuments[0]).toMatchObject({ effect: "unknown", status: "unknown" });
    expect(card.visa?.otherDocuments[0].notes).toMatch(/Couldn't verify/);
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

  it("passes travel documents and restrictions through to the cards", async () => {
    const withDocs: Profile = {
      ...profile,
      travelDocs: {
        residencePermits: ["GB"],
        visasHeld: [{ country: "US", kind: "tourist", expires: null }],
        restrictions: "Previous visa refusal for the UK",
        avoidAdvanceVisa: false,
      },
    };
    const r = await runFit(["Lisbon"], { kind: "month", month: 5 }, withDocs, () => {});
    expect(r.candidates[0].visa?.otherDocuments).toHaveLength(2);
    expect(r.candidates[0].restrictions[0].concern).toMatch(/visa refusal/);
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
  const dest = { candidates: ["Lisbon"], timing, travelDocs: null, result: null };

  it("first confirmation unlocks interests", () => {
    const t = createTrip();
    expect(withConfirmedDestination(t, { place, stops: [], timing }, dest).phase).toBe(2);
  });

  it("changing the destination wipes research-based phases but keeps interests", () => {
    const t = { ...createTrip(), phase: 5 };
    t.state = {
      ...t.state,
      destination: { ...dest, confirmed: { place, stops: [], timing } },
      interests: { chips: ["hiking"], custom: [], mix: { outdoors: 100, city: 0, food: 0, nightlife: 0, wellness: 0 }, requirements: [], rules: [], notices: [] },
      discover: { pool: [], kept: [], removed: [], researchedFor: { place: "", stops: [], batches: {} }, updatedAt: "" },
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
