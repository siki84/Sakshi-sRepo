import { z } from "zod";

/**
 * Domain schemas: the single source of truth for what we store and render.
 * AI response schemas live in lib/ai/schemas.ts and are mapped into these.
 */

export const PHASES = [
  { key: "destination", label: "Where", n: 1 },
  { key: "interests", label: "Interests", n: 2 },
  { key: "discover", label: "Discover", n: 3 },
  { key: "length", label: "How long", n: 4 },
  { key: "plan", label: "Plan", n: 5 },
] as const;
export type PhaseKey = (typeof PHASES)[number]["key"];

export const Tolerance = z.enum(["love", "ok", "dislike", "hate"]);
export type Tolerance = z.infer<typeof Tolerance>;

export const WeatherPrefsSchema = z
  .object({
    idealMinF: z.number().min(-20).max(120),
    idealMaxF: z.number().min(-20).max(120),
    heat: Tolerance, // hotter than the ideal range
    cold: Tolerance, // colder than the ideal range
    humidity: Tolerance, // muggy / sticky air
    rain: Tolerance, // frequent rainy days
    notes: z.string().max(500).default(""),
  })
  .refine((w) => w.idealMinF < w.idealMaxF, {
    message: "The low end of your ideal range must be below the high end",
    path: ["idealMaxF"],
  });
export type WeatherPrefs = z.infer<typeof WeatherPrefsSchema>;

export const ProfileSchema = z.object({
  homeCity: z.string().trim().min(1, "Enter your home city"),
  passports: z.array(z.string().length(2)).min(1, "Add at least one passport"), // ISO 3166-1 alpha-2
  weather: WeatherPrefsSchema,
  travelers: z.object({
    type: z.enum(["solo", "partner", "family", "friends"]),
    kidsAges: z.array(z.number().int().min(0).max(17)).max(10).default([]),
    groupSize: z.number().int().min(1).max(30).default(1),
  }),
  pace: z.number().int().min(1).max(5), // 1 = very relaxed, 5 = packed
  units: z.enum(["F", "C"]).default("F"),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const SourceRef = z.object({
  url: z.string().url(),
  title: z.string().default(""),
});
export type SourceRef = z.infer<typeof SourceRef>;

/**
 * Whole-trip state. Each phase's payload is optional until that phase runs;
 * phase payload shapes are tightened as each milestone lands.
 */
export const TripStateSchema = z.object({
  destination: z.unknown().optional(),
  interests: z.unknown().optional(),
  discover: z.unknown().optional(),
  length: z.unknown().optional(),
  plan: z.unknown().optional(),
  /** Phases whose inputs changed after they were produced. */
  stale: z.array(z.string()).default([]),
});
export type TripState = z.infer<typeof TripStateSchema>;

export type Trip = {
  id: string;
  shareId: string;
  title: string;
  /** Highest phase number the user has reached (1–5). */
  phase: number;
  state: TripState;
  createdAt: string;
  updatedAt: string;
};
