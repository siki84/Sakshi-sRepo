import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import { extractJson, normalizeUrl, runStructured, validate, type SearchResult } from "@/lib/ai/client";
import { registerFixture } from "@/lib/ai/fixtures/index";
import { unverifiedUrls, verifiedSources } from "@/lib/ai/sources";

describe("extractJson", () => {
  it("parses plain JSON", () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
  it("tolerates prose and code fences", () =>
    expect(extractJson('Here you go:\n```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] }));
  it("throws when there is no JSON", () => expect(() => extractJson("nope")).toThrow());
});

describe("normalizeUrl", () => {
  it("ignores www, trailing slash, hash, utm params and case", () => {
    expect(normalizeUrl("https://www.Reddit.com/r/lisbon/?utm_source=x#top")).toBe(
      normalizeUrl("https://reddit.com/r/lisbon"),
    );
  });
});

describe("source verification", () => {
  const results = new Map<string, SearchResult>([
    [normalizeUrl("https://reddit.com/r/lisbon/abc"), { url: "https://reddit.com/r/lisbon/abc", title: "Thread" }],
  ]);
  it("flags URLs that web search never returned", () => {
    expect(unverifiedUrls(["https://www.reddit.com/r/lisbon/abc/", "https://made.up/page"], results)).toEqual([
      "https://made.up/page",
    ]);
  });
  it("keeps only verified sources, deduped, with titles", () => {
    expect(
      verifiedSources(["https://reddit.com/r/lisbon/abc", "https://www.reddit.com/r/lisbon/abc", "https://x.y"], results),
    ).toEqual([{ url: "https://reddit.com/r/lisbon/abc", title: "Thread" }]);
  });
});

describe("validate", () => {
  const schema = z.object({ n: z.number().int().min(1) });
  it("reports schema problems with paths", () => {
    const r = validate({ n: 0 }, { schema }, new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatch(/^n:/);
  });
  it("runs semantic checks after the schema passes", () => {
    const r = validate({ n: 3 }, { schema, check: (d) => (d.n % 2 ? ["n must be even"] : []) }, new Map());
    expect(r).toEqual({ ok: false, problems: ["n must be even"] });
  });
});

describe("runStructured in MOCK_AI mode", () => {
  beforeEach(() => {
    process.env.MOCK_AI = "1";
  });

  it("returns validated fixture data and replays search progress", async () => {
    const seen: string[] = [];
    const r = await runStructured({
      task: "ping",
      system: "",
      prompt: "",
      schema: z.object({ reply: z.string() }),
      onProgress: (p) => p.type === "search" && seen.push(p.query),
    });
    expect(r.data.reply).toBe("pong");
    expect(seen).toEqual(["ping test"]);
  });

  it("holds fixtures to the same validation bar", async () => {
    registerFixture("bad", () => ({ data: { reply: 1 }, queries: [], searchResults: [] }));
    await expect(
      runStructured({ task: "bad", system: "", prompt: "", schema: z.object({ reply: z.string() }) }),
    ).rejects.toThrow(/failed validation/);
  });
});
