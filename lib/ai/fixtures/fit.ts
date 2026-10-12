import type { FitLabel, Place } from "../../schemas";
import type { Fixture } from "./index";

/** MOCK_AI fixtures for Phase 1. Clearly labelled as sample data in the UI text. */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function fitResearchFixture(input: unknown): Fixture {
  const { place, domestic, passports, weatherLabel, docs, restrictions } = input as {
    place: Place;
    domestic: boolean;
    passports: string[];
    weatherLabel: FitLabel | null;
    docs: string[];
    restrictions: string;
  };
  const s = slug(place.name);
  const urls = {
    reddit: `https://www.reddit.com/r/travel/comments/${s}-when-to-visit`,
    blog: `https://example-travel-blog.com/${s}-month-by-month`,
    visa: `https://example-gov.org/entry-requirements/${s}`,
  };
  return {
    queries: [`site:reddit.com ${place.name} best time to visit`, `${place.name} festivals`, `${place.name} visa requirements`],
    searchResults: [
      { url: urls.reddit, title: `When to visit ${place.name}? : r/travel` },
      { url: urls.blog, title: `${place.name} month by month` },
      { url: urls.visa, title: `Entry requirements — ${place.name}` },
    ],
    data: {
      vibe: `[Sample data] ${place.name} — lively streets and long evenings.`,
      weatherVerdict: `[Sample data] Weather fit is ${weatherLabel ?? "unknown"} based on the computed numbers.`,
      season: {
        level: "shoulder",
        crowds: "moderate",
        prices: "moderate",
        summary: "[Sample data] Busy but not peak; book popular restaurants a few days ahead.",
        sourceUrls: [urls.reddit, urls.blog],
      },
      events: [
        {
          name: "Sample street festival",
          kind: "festival",
          impact: "positive",
          when: "mid-month",
          detail: "[Sample data] Music and food stalls in the old town.",
          sourceUrls: [urls.blog],
        },
        {
          name: "Unsourced rumour",
          kind: "closure",
          impact: "negative",
          when: "all month",
          detail: "This has no verified source and must be dropped.",
          sourceUrls: ["https://made-up.example/never-searched"],
        },
      ],
      visa: domestic
        ? null
        : {
            perPassport: passports.map((p) => ({
              passport: p,
              status: "visa_free",
              maxStay: "90 days",
              leadTime: null,
              notes: "[Sample data] Passport valid 6 months beyond stay.",
              sourceUrls: [urls.visa],
            })),
            otherDocuments: docs.map((doc) => ({
              document: doc,
              effect: "eases_entry",
              status: "visa_free",
              notes: "[Sample data] Holders may qualify for simplified entry.",
              sourceUrls: [urls.visa],
            })),
            officialUrl: urls.visa,
            confidence: "medium",
          },
      restrictions: restrictions.trim()
        ? [
            {
              concern: restrictions.trim().slice(0, 80),
              impact: "caution",
              notes: "[Sample data] Declare it honestly on the arrival form; check with the embassy if unsure.",
              sourceUrls: [urls.visa],
            },
          ]
        : [],
      overall: {
        label: weatherLabel ?? "mixed",
        summary: `[Sample data] Overall ${weatherLabel ?? "unknown"} fit, mostly driven by weather.`,
      },
    },
  };
}

export function fitCompareFixture(input: unknown): Fixture {
  const { names, cards } = input as { names: string[]; cards: { overall: { label: FitLabel } }[] };
  const rank = { poor: 0, mixed: 1, good: 2, great: 3 };
  const best = cards.reduce((bi, c, i) => (rank[c.overall.label] > rank[cards[bi].overall.label] ? i : bi), 0);
  const good = rank[cards[best].overall.label] >= 2;
  return {
    queries: [],
    searchResults: [],
    data: {
      summary: `[Sample data] ${names.join(" vs ")}: ${good ? `${names[best]} wins on weather.` : "neither is a strong fit."}`,
      pick: good ? names[best] : null,
    },
  };
}

export function fitAlternativesFixture(input: unknown): Fixture {
  const { original } = input as { original: string[] };
  const pool = ["Kyoto, Japan", "San Sebastian, Spain", "Madeira, Portugal", "Taipei, Taiwan", "Chiang Mai, Thailand", "Porto, Portugal"];
  const taken = original.map((o) => o.toLowerCase().split(",")[0].trim());
  return {
    queries: [],
    searchResults: [],
    data: {
      note: "[Sample data] Similar food-and-culture cities with milder weather that month.",
      alternatives: pool
        .filter((p) => !taken.includes(p.toLowerCase().split(",")[0]))
        .map((name) => ({ name, whySimilar: "[Sample data] Similar mix of food, culture, and walkable neighborhoods." })),
    },
  };
}
