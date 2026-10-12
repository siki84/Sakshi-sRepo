import { z } from "zod";
import { FitLabel, VisaStatus } from "../schemas";

/**
 * Schemas for what Claude returns. Kept flat and constraint-light so they compile
 * cleanly to structured-output JSON Schema; semantic rules live in `check` functions.
 * URLs are plain strings here and verified against web search results afterwards.
 */

const Urls = z.array(z.string()).describe("URLs of web search results that support this; never invent URLs");

export const FitResearchAi = z.object({
  vibe: z.string().describe("One line on what the place is like at this time of year"),
  weatherVerdict: z
    .string()
    .describe("1–2 plain-language sentences on the weather fit, consistent with the computed score and reasons"),
  season: z.object({
    level: z.enum(["peak", "shoulder", "off"]),
    crowds: z.enum(["low", "moderate", "high", "very_high"]),
    prices: z.enum(["low", "moderate", "high", "very_high"]),
    summary: z.string().describe("1–2 sentences: crowds, prices, what's special or closed"),
    sourceUrls: Urls,
  }),
  events: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum(["festival", "holiday", "closure", "weather_hazard", "seasonal_activity", "other"]),
        impact: z.enum(["positive", "negative", "neutral"]),
        when: z.string().describe('e.g. "June 12–13" or "most of August"'),
        detail: z.string().describe("One sentence on why it matters to a visitor"),
        sourceUrls: Urls,
      }),
    )
    .describe("Up to 5 notable festivals, closures, hazards, or seasonal activities during the trip window"),
  visa: z
    .object({
      perPassport: z.array(
        z.object({
          passport: z.string().describe("ISO 3166-1 alpha-2 code of the passport"),
          status: VisaStatus,
          maxStay: z.string().nullable().describe('e.g. "90 days in any 180"'),
          leadTime: z.string().nullable().describe('How far ahead to apply, e.g. "apply 72h+ before"; null if none'),
          notes: z.string().describe("Key conditions (passport validity, onward ticket, ETIAS/ETA, fees)"),
          sourceUrls: Urls,
        }),
      ),
      otherDocuments: z
        .array(
          z.object({
            document: z.string().describe('The traveler\'s document, as listed, e.g. "US tourist visa" or "Schengen residence permit (DE)"'),
            effect: z.enum(["grants_entry", "eases_entry", "no_effect", "unknown"]),
            status: VisaStatus.describe("Entry status when relying on this document (unknown if it has no effect)"),
            notes: z.string().describe("Conditions, e.g. visa must be valid for the whole stay, multiple-entry only"),
            sourceUrls: Urls,
          }),
        )
        .describe("One entry per residence permit / visa the traveler listed; empty if they listed none"),
      officialUrl: z.string().nullable().describe("Official government entry-requirements page, if search returned one"),
      confidence: z.enum(["high", "medium", "low"]),
    })
    .nullable()
    .describe("null only when told the trip is domestic"),
  restrictions: z
    .array(
      z.object({
        concern: z.string().describe("The traveler's stated restriction or concern, briefly"),
        impact: z.enum(["blocker", "caution", "ok", "unknown"]),
        notes: z.string().describe("What it means for entering/visiting this destination, and what to do"),
        sourceUrls: Urls,
      }),
    )
    .describe("One entry per restriction/concern the traveler listed; empty if they listed none"),
  overall: z.object({
    label: FitLabel,
    summary: z.string().describe("2 sentences: the honest bottom line for this traveler"),
  }),
});
export type FitResearchAi = z.infer<typeof FitResearchAi>;

export const ComparisonAi = z.object({
  summary: z.string().describe("2–4 sentences comparing the options side by side for this traveler"),
  pick: z.string().nullable().describe("Exact name of the better option, or null if neither fits well / it's a toss-up"),
});
export type ComparisonAi = z.infer<typeof ComparisonAi>;

export const AlternativesAi = z.object({
  note: z.string().describe("One sentence on why these were suggested"),
  alternatives: z.array(
    z.object({
      name: z.string().describe('Geocodable "City, Country" (or "Region, Country")'),
      whySimilar: z.string().describe("One line: what it shares with the original idea"),
    }),
  ),
});
export type AlternativesAi = z.infer<typeof AlternativesAi>;
