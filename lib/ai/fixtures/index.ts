import type { SearchResult } from "../client";

/**
 * MOCK_AI fixtures: canned model output per task, used by tests and offline dev.
 * Fixtures go through the same schema + semantic validation as live output.
 */
export type Fixture = {
  data: unknown;
  /** Search queries to replay as progress events. */
  queries: string[];
  /** Pretend web search results (sources must come from here). */
  searchResults: SearchResult[];
};

type FixtureFn = (input: unknown) => Fixture;

const registry: Record<string, FixtureFn> = {
  ping: () => ({
    data: { reply: "pong" },
    queries: ["ping test"],
    searchResults: [{ url: "https://example.com/ping", title: "Ping" }],
  }),
};

export function registerFixture(task: string, fn: FixtureFn) {
  registry[task] = fn;
}

export function getFixture(task: string, input: unknown): Fixture {
  const fn = registry[task];
  if (!fn) throw new Error(`No MOCK_AI fixture registered for task "${task}"`);
  return fn(input);
}
