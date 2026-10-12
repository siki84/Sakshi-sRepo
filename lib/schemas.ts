import { z } from "zod";
import { GROUP_KEYS, type Group } from "./interests";

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

export const VisaHeldSchema = z.object({
  country: z.string().length(2), // issuing country, e.g. US for a US B1/B2 visa
  kind: z.enum(["tourist", "business", "student", "work", "transit", "other"]),
  expires: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});
export type VisaHeld = z.infer<typeof VisaHeldSchema>;

/** Things beyond the passport that change what's possible at a border. */
export const TravelDocsSchema = z.object({
  residencePermits: z.array(z.string().length(2)).max(10).default([]), // green card, Schengen permit, UK BRP…
  visasHeld: z.array(VisaHeldSchema).max(10).default([]),
  /** Free text: past overstays/refusals, criminal record, passport stamps, vaccinations, traveling with a minor… */
  restrictions: z.string().max(800).default(""),
  /** Only consider places enterable without applying for a visa in advance. */
  avoidAdvanceVisa: z.boolean().default(false),
});
export type TravelDocs = z.infer<typeof TravelDocsSchema>;
export const EMPTY_TRAVEL_DOCS: TravelDocs = { residencePermits: [], visasHeld: [], restrictions: "", avoidAdvanceVisa: false };

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
  travelDocs: TravelDocsSchema.default(() => ({ ...EMPTY_TRAVEL_DOCS })),
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
  destination: z.lazy(() => DestinationStateSchema).optional(),
  interests: z.lazy(() => InterestsStateSchema).optional(),
  discover: z.lazy(() => DiscoverStateSchema).optional(),
  length: z.lazy(() => LengthStateSchema).optional(),
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

// ---------- Phase 1: destination fit ----------

export const TimingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("month"),
    month: z.number().int().min(1).max(12),
    /** Rough trip length the traveler has in mind (null = not sure). Exact dates imply their own length. */
    approxDays: z.number().int().min(1).max(60).nullable().default(null),
  }),
  z.object({
    kind: z.literal("dates"),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);
export type Timing = z.infer<typeof TimingSchema>;

export const PlaceSchema = z.object({
  query: z.string(),
  name: z.string(), // short display name, e.g. "Lisbon, Portugal"
  lat: z.number(),
  lng: z.number(),
  countryCode: z.string().length(2).nullable(),
});
export type Place = z.infer<typeof PlaceSchema>;

export const ClimateSchema = z.object({
  source: z.enum(["normals", "forecast"]),
  /** e.g. "July, 2016–2025" or "Forecast for Oct 14–18" */
  basis: z.string(),
  avgHighF: z.number(),
  avgLowF: z.number(),
  rainyDaysPerMonth: z.number(), // days with ≥1 mm, scaled to 30 days
  precipMmPerMonth: z.number(),
  dewPointF: z.number().nullable(),
  humidityPct: z.number().nullable(),
  daylightHours: z.number().nullable(),
  sunshineHours: z.number().nullable(),
});
export type Climate = z.infer<typeof ClimateSchema>;

export const FitLabel = z.enum(["great", "good", "mixed", "poor"]);
export type FitLabel = z.infer<typeof FitLabel>;

export const WeatherFitSchema = z.object({
  score: z.number(), // 0–100
  label: FitLabel,
  reasons: z.array(z.object({ tone: z.enum(["good", "bad", "neutral"]), text: z.string() })),
});
export type WeatherFit = z.infer<typeof WeatherFitSchema>;

export const VisaStatus = z.enum([
  "visa_free",
  "evisa",
  "eta",
  "visa_on_arrival",
  "visa_required",
  "not_allowed",
  "unknown",
]);
export type VisaStatus = z.infer<typeof VisaStatus>;

export const FitCardSchema = z.object({
  place: PlaceSchema,
  climate: ClimateSchema.nullable(),
  weatherFit: WeatherFitSchema.nullable(),
  weatherVerdict: z.string(),
  vibe: z.string(),
  season: z.object({
    level: z.enum(["peak", "shoulder", "off"]),
    crowds: z.enum(["low", "moderate", "high", "very_high"]),
    prices: z.enum(["low", "moderate", "high", "very_high"]),
    summary: z.string(),
    sources: z.array(SourceRef),
  }),
  events: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["festival", "holiday", "closure", "weather_hazard", "seasonal_activity", "other"]),
      impact: z.enum(["positive", "negative", "neutral"]),
      when: z.string(),
      detail: z.string(),
      sources: z.array(SourceRef),
    }),
  ),
  /** null for domestic trips (destination is a passport country). */
  visa: z
    .object({
      best: z.object({
        passport: z.string(),
        /** Set when another document (e.g. "your US visa") gives the easiest entry. */
        via: z.string().nullable().default(null),
        status: VisaStatus,
        maxStay: z.string().nullable(),
        leadTime: z.string().nullable(),
        notes: z.string(),
      }),
      perPassport: z.array(
        z.object({
          passport: z.string(),
          status: VisaStatus,
          maxStay: z.string().nullable(),
          leadTime: z.string().nullable(),
          notes: z.string(),
          sources: z.array(SourceRef),
        }),
      ),
      otherDocuments: z
        .array(
          z.object({
            document: z.string(),
            effect: z.enum(["grants_entry", "eases_entry", "no_effect", "unknown"]),
            status: VisaStatus,
            notes: z.string(),
            sources: z.array(SourceRef),
          }),
        )
        .default([]),
      officialUrl: z.string().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
      sources: z.array(SourceRef),
    })
    .nullable(),
  /** Answers to the traveler's own stated restrictions/concerns. */
  restrictions: z
    .array(
      z.object({
        concern: z.string(),
        impact: z.enum(["blocker", "caution", "ok", "unknown"]),
        notes: z.string(),
        sources: z.array(SourceRef),
      }),
    )
    .default([]),
  overall: z.object({ label: FitLabel, summary: z.string() }),
});
export type FitCard = z.infer<typeof FitCardSchema>;

export const FitResultSchema = z.object({
  candidates: z.array(FitCardSchema),
  comparison: z.object({ summary: z.string(), pick: z.string().nullable() }).nullable(),
  alternatives: z.array(FitCardSchema),
  alternativesNote: z.string().nullable(),
  /** Candidates that couldn't be researched (e.g. place not found). */
  failures: z.array(z.object({ query: z.string(), error: z.string() })).default([]),
});
export type FitResult = z.infer<typeof FitResultSchema>;

export const DestinationStateSchema = z.object({
  candidates: z.array(z.string()),
  timing: TimingSchema,
  /** Travel documents/restrictions the traveler confirmed for this trip before research ran. */
  travelDocs: TravelDocsSchema.nullable().default(null),
  result: FitResultSchema.nullable(),
  confirmed: z
    .object({
      place: PlaceSchema,
      /** Extra stops for a multi-city route (in order, after the main place). */
      stops: z.array(z.string()),
      timing: TimingSchema,
    })
    .nullable(),
});
export type DestinationState = z.infer<typeof DestinationStateSchema>;

// ---------- Phase 2: interests ----------

export const GroupSchema = z.enum(GROUP_KEYS as [Group, ...Group[]]);

export const MixSchema = z
  .object({
    outdoors: z.number().int().min(0).max(100),
    city: z.number().int().min(0).max(100),
    food: z.number().int().min(0).max(100),
    nightlife: z.number().int().min(0).max(100),
    wellness: z.number().int().min(0).max(100),
  })
  .refine((m) => Object.values(m).reduce((a, b) => a + b, 0) === 100, { message: "Mix must add up to 100%" });

export const RequirementRuleSchema = z.object({
  /** The traveler's original wording. */
  text: z.string(),
  kind: z.enum(["min_count", "max_count", "exclude", "must_include", "time_pref", "other"]),
  /** Chip key this applies to, if any. */
  category: z.string().nullable(),
  count: z.number().int().nullable(),
  /** A specific named place or experience, e.g. "Louvre" or "sunset sail". */
  place: z.string().nullable(),
  /** Short plain-language interpretation shown back to the traveler. */
  summary: z.string(),
});
export type RequirementRule = z.infer<typeof RequirementRuleSchema>;

export const InterestsStateSchema = z.object({
  chips: z.array(z.string()).min(1),
  custom: z.array(z.object({ key: z.string(), label: z.string().min(1).max(40), group: GroupSchema })).max(12),
  mix: MixSchema,
  requirements: z.array(z.string().trim().min(2).max(200)).max(10),
  rules: z.array(RequirementRuleSchema),
  /** Things we changed or noticed while interpreting requirements. */
  notices: z.array(z.string()).default([]),
});
export type InterestsState = z.infer<typeof InterestsStateSchema>;

// ---------- Phase 3: discovery ----------

export const BestTime = z.enum(["morning", "afternoon", "evening", "any"]);
export type BestTime = z.infer<typeof BestTime>;

export const ActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Chip key (catalog or custom). */
  category: z.string(),
  tag: z.enum(["must_see", "local_gem"]),
  why: z.string(),
  area: z.string(),
  /** City/stop this belongs to (multi-city routes). */
  city: z.string(),
  durationHrs: z.number().min(0.25).max(12),
  bestTime: BestTime,
  setting: z.enum(["indoor", "outdoor", "mixed"]),
  kidFriendly: z.boolean(),
  /** 1–5: how strongly/consistently it's recommended across sources. */
  buzz: z.number().int().min(1).max(5),
  lat: z.number(),
  lng: z.number(),
  /** True when an independent geocoder confirmed the location near the destination. */
  locationVerified: z.boolean(),
  sources: z.array(SourceRef).min(1),
  /** Set for results of "more like this". */
  similarTo: z.string().nullable().default(null),
  /** Research batch it came from ("must_see", a group, "stop:<city>", or "more"). */
  batch: z.string().default(""),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const DiscoverStateSchema = z.object({
  pool: z.array(ActivitySchema),
  kept: z.array(z.string()),
  removed: z.array(z.string()),
  /** What the pool was researched for; used to refresh only what changed. */
  researchedFor: z.object({
    place: z.string(),
    stops: z.array(z.string()),
    /** "must_see" plus one key per group, each with the chips researched. */
    batches: z.record(z.string(), z.array(z.string())),
  }),
  updatedAt: z.string(),
});
export type DiscoverState = z.infer<typeof DiscoverStateSchema>;

// ---------- Phase 4: trip length ----------

export const DailyForecastSchema = z.object({
  date: z.string(),
  highF: z.number(),
  lowF: z.number(),
  precipMm: z.number(),
  precipProb: z.number().nullable(),
});
export type DailyForecast = z.infer<typeof DailyForecastSchema>;

export const LengthOptionSchema = z.object({
  days: z.number().int().min(1),
  /** Activities this option has room for. */
  itemIds: z.array(z.string()),
  breakdown: z.object({
    activityHours: z.number(),
    hoursPerDay: z.number(),
    cityDays: z.number(),
    dayTrips: z.number(),
    travelDays: z.number(),
    arrivalBuffer: z.number(),
  }),
});
export type LengthOption = z.infer<typeof LengthOptionSchema>;

export const LengthStateSchema = z.object({
  /** Activities the recommendation is based on (kept picks, topped up with top-ranked ones). */
  selectionIds: z.array(z.string()),
  usedTopRanked: z.boolean(),
  options: z.object({ min: LengthOptionSchema, ideal: LengthOptionSchema, generous: LengthOptionSchema }),
  advice: z.object({
    headline: z.string(),
    min: z.string(),
    ideal: z.string(),
    generous: z.string(),
    approxNote: z.string().nullable(),
  }),
  approxDays: z.number().nullable(),
  chosenDays: z.number().int().min(1).max(60).nullable(),
  startDate: z.string().nullable(),
  forecast: z.array(DailyForecastSchema).nullable(),
  generatedAt: z.string(),
});
export type LengthState = z.infer<typeof LengthStateSchema>;
