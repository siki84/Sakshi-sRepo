import { RESEARCH_SYSTEM } from "./fit";

export const DISCOVER_SYSTEM = `${RESEARCH_SYSTEM}

You are now building a pool of things to do for this traveler.
- "must_see": the iconic things most visitors would regret skipping.
- "local_gem": what locals and repeat visitors recommend that does NOT appear on generic top-10 lists — specific cafés, viewpoints, trails, neighborhoods, markets, bars, small museums.
Favor recent (last ~3 years), specific, first-hand recommendations: Reddit (r/travel and the city's own subreddit), Pinterest travel boards, local blogs and guides, Atlas Obscura. Avoid listicle filler and anything permanently closed.
For each item give your best-estimate coordinates (the app double-checks them), a realistic time on site (not travel time), and the best time of day given the season's weather.`;

export function discoverBatchPrompt(args: {
  city: string;
  timingText: string;
  profileText: string;
  weatherText: string;
  kind: "must_see" | "group" | "stop";
  focusText: string;
  allowedCategories: { key: string; label: string }[];
  requirementsText: string;
  excludedText: string;
  modifiersText: string;
  count: number;
}): string {
  const ask =
    args.kind === "must_see"
      ? `Find the ${args.count} most iconic must-sees in ${args.city} for this trip (any category). Tag them "must_see" unless they're genuinely off the beaten path.`
      : args.kind === "stop"
        ? `This is one stop on a multi-city route. Find ${args.count} of the best things to do in ${args.city} for this traveler's interests: a few must-sees and mostly local gems.`
        : `Find ${args.count} things to do in ${args.city} for these interests: ${args.focusText}. At least 60% should be local gems (tag "local_gem"); the rest can be well-known must-sees in these categories.`;
  return `City: ${args.city}
When: ${args.timingText}
Weather then: ${args.weatherText}

Traveler:
${args.profileText}
${args.modifiersText}

${ask}

Hard requirements: ${args.requirementsText}
Never include: ${args.excludedText}

Rules:
- category must be one of these keys: ${args.allowedCategories.map((c) => `${c.key} (${c.label})`).join(", ")}
- Every item needs at least one sourceUrl taken from your web search results. Skip anything you can't source.
- buzz: 1–5, how strongly and consistently it's recommended across your sources.
- area: the neighborhood or district (used to group days geographically).
- Only places in or within a day trip of ${args.city}.`;
}

export function moreLikeThisPrompt(args: {
  city: string;
  timingText: string;
  profileText: string;
  seed: { name: string; category: string; why: string; area: string; tag: string };
  exclude: string[];
  allowedCategories: { key: string; label: string }[];
  excludedText: string;
}): string {
  return `City: ${args.city}
When: ${args.timingText}

Traveler:
${args.profileText}

They loved this idea: "${args.seed.name}" (${args.seed.category}, ${args.seed.area}) — ${args.seed.why}
Find 5 more places or experiences in ${args.city} with the same appeal. Prefer local gems.
Don't repeat any of these: ${args.exclude.join("; ")}
Never include: ${args.excludedText}
category must be one of: ${args.allowedCategories.map((c) => c.key).join(", ")}.
Every item needs at least one sourceUrl from your web search results.`;
}
