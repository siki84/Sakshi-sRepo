import type { Fixture } from "./index";

export function lengthAdviceFixture(input: unknown): Fixture {
  const { options, approxDays, place, cut, added } = input as {
    options: { min: { days: number }; ideal: { days: number }; generous: { days: number } };
    approxDays: number | null;
    place: string;
    cut: string[];
    added: string[];
  };
  const city = place.split(",")[0];
  return {
    queries: [],
    searchResults: [],
    data: {
      headline: `[Sample] ${city}: ${options.ideal.days} days — enough for your picks at a comfortable pace.`,
      min: `[Sample] ${options.min.days} days covers the essentials${cut.length ? `; skips ${cut.slice(0, 2).join(", ")}` : ""}.`,
      ideal: `[Sample] ${options.ideal.days} days fits everything you kept without rushing.`,
      generous: `[Sample] ${options.generous.days} days adds breathing room${added.length ? ` and ${added.slice(0, 2).join(", ")}` : ""}.`,
      approxNote: approxDays === null ? null : `[Sample] You had about ${approxDays} days in mind.`,
    },
  };
}
