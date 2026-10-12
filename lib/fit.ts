import { cached, cacheKey } from "./cache";
import { geocode } from "./geo/nominatim";
import { getClimateNormals, getForecast } from "./weather/openMeteo";
import { LABEL_TEXT, scoreWeather } from "./weather/score";
import { forecastWindow, isoDay, monthsOf } from "./timing";
import { describeDocList, describeProfile, describeTravelDocs } from "./profileText";
import { runStructured, type ProgressFn, type SearchResult } from "./ai/client";
import { AlternativesAi, ComparisonAi, FitResearchAi } from "./ai/schemas";
import { RESEARCH_SYSTEM, alternativesPrompt, comparisonPrompt, fitResearchPrompt } from "./ai/prompts/fit";
import { verifiedSources } from "./ai/sources";
import { EMPTY_TRAVEL_DOCS } from "./schemas";
import type { Climate, FitCard, FitLabel, FitResult, Place, Profile, Timing, TravelDocs, VisaStatus, WeatherFit } from "./schemas";

const RANK: Record<FitLabel, number> = { poor: 0, mixed: 1, good: 2, great: 3 };
const VISA_PREFERENCE: VisaStatus[] = ["visa_free", "eta", "visa_on_arrival", "evisa", "visa_required", "not_allowed", "unknown"];
/** Statuses that mean applying for a visa before travel. */
const ADVANCE_VISA: VisaStatus[] = ["evisa", "visa_required"];
const byPreference = (a: VisaStatus, b: VisaStatus) => VISA_PREFERENCE.indexOf(a) - VISA_PREFERENCE.indexOf(b);

export type FitCheckOpts = {
  domestic: boolean;
  passports: string[];
  weatherLabel: FitLabel | null;
  docCount: number;
  hasRestrictions: boolean;
  avoidAdvanceVisa: boolean;
};

/** Easiest entry status across passports and any other document that grants/eases entry. */
export function effectiveVisaStatus(d: FitResearchAi): VisaStatus | null {
  if (!d.visa) return null;
  const statuses = [
    ...d.visa.perPassport.map((p) => p.status),
    ...d.visa.otherDocuments.filter((o) => o.effect === "grants_entry" || o.effect === "eases_entry").map((o) => o.status),
  ];
  return statuses.sort(byPreference)[0] ?? "unknown";
}
const FIT_CACHE_DAYS = 30;
const RESEARCH_VERSION = 2; // bump when prompts/schemas change meaningfully

export class UserFacingError extends Error {}

export const isGoodFit = (c: FitCard) => c.overall.label === "great" || c.overall.label === "good";

/** Semantic rules for a fit research response (beyond the schema). */
export function checkFitResearch(
  d: FitResearchAi,
  ctx: { searchResults: Map<string, SearchResult> },
  opts: FitCheckOpts,
): string[] {
  const problems: string[] = [];
  if (!verifiedSources(d.season.sourceUrls, ctx.searchResults).length) {
    problems.push("season.sourceUrls must include at least one URL returned by your web searches");
  }
  if (opts.domestic) {
    if (d.visa !== null) problems.push("visa must be null for a domestic trip");
  } else if (!d.visa) {
    problems.push("visa is required (this is an international trip)");
  } else {
    const got = d.visa.perPassport.map((p) => p.passport.toUpperCase()).sort();
    const want = [...opts.passports].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`visa.perPassport must have exactly one entry for each of: ${want.join(", ")}`);
    }
    const anySourced = d.visa.perPassport.some((p) => verifiedSources(p.sourceUrls, ctx.searchResults).length);
    if (!anySourced) problems.push("visa needs at least one source URL that came from your web searches");
    const allBlocked = d.visa.perPassport.length > 0 && d.visa.perPassport.every((p) => p.status === "not_allowed");
    if (allBlocked && d.overall.label !== "poor") problems.push('overall.label must be "poor" when entry is not allowed');
    if (d.visa.otherDocuments.length !== opts.docCount) {
      problems.push(`visa.otherDocuments must have exactly ${opts.docCount} entries (one per document the traveler listed)`);
    }
    const easiest = effectiveVisaStatus(d);
    if (opts.avoidAdvanceVisa && easiest && ADVANCE_VISA.includes(easiest) && d.overall.label !== "poor") {
      problems.push('overall.label must be "poor": the traveler only wants places that need no visa applied for in advance');
    }
  }
  if (opts.hasRestrictions && d.restrictions.length === 0) {
    problems.push("restrictions must address each restriction/concern the traveler mentioned");
  }
  if (d.restrictions.some((r) => r.impact === "blocker") && d.overall.label !== "poor") {
    problems.push('overall.label must be "poor" when one of the traveler\'s restrictions is a blocker');
  }
  if (opts.weatherLabel && RANK[d.overall.label] > RANK[opts.weatherLabel]) {
    problems.push(
      `overall.label "${d.overall.label}" can't be better than the computed weather fit "${opts.weatherLabel}"`,
    );
  }
  return problems;
}

/** Map validated AI output + computed data into the card we store and render. */
export function buildCard(
  d: FitResearchAi,
  search: Map<string, SearchResult>,
  base: { place: Place; climate: Climate | null; weatherFit: WeatherFit | null },
): FitCard {
  const visa = d.visa
    ? (() => {
        const perPassport = d.visa.perPassport.map((p) => ({
          passport: p.passport.toUpperCase(),
          status: p.status,
          maxStay: p.maxStay,
          leadTime: p.leadTime,
          notes: p.notes,
          sources: verifiedSources(p.sourceUrls, search),
        }));
        // A document only counts toward "easiest entry" if a real source backs it up.
        const otherDocuments = d.visa.otherDocuments.map((o) => {
          const sources = verifiedSources(o.sourceUrls, search);
          const unverified = !sources.length && o.effect !== "no_effect" && o.effect !== "unknown";
          return {
            document: o.document,
            effect: unverified ? ("unknown" as const) : o.effect,
            status: unverified ? ("unknown" as const) : o.status,
            notes: unverified ? `${o.notes} (Couldn't verify this with a source — check with the embassy.)` : o.notes,
            sources,
          };
        });
        const bestPassport = [...perPassport].sort((a, b) => byPreference(a.status, b.status))[0];
        const bestDoc = otherDocuments
          .filter((o) => o.effect === "grants_entry" || o.effect === "eases_entry")
          .sort((a, b) => byPreference(a.status, b.status))[0];
        const best =
          bestDoc && byPreference(bestDoc.status, bestPassport.status) < 0
            ? { passport: bestPassport.passport, via: bestDoc.document, status: bestDoc.status, maxStay: null, leadTime: null, notes: bestDoc.notes }
            : { passport: bestPassport.passport, via: null, status: bestPassport.status, maxStay: bestPassport.maxStay, leadTime: bestPassport.leadTime, notes: bestPassport.notes };
        const official = d.visa.officialUrl ? verifiedSources([d.visa.officialUrl], search)[0] : undefined;
        const allSources = verifiedSources(
          [...d.visa.perPassport.flatMap((p) => p.sourceUrls), ...d.visa.otherDocuments.flatMap((o) => o.sourceUrls)],
          search,
        );
        return {
          best,
          perPassport,
          otherDocuments,
          officialUrl: official?.url ?? null,
          confidence: d.visa.confidence,
          sources: allSources,
        };
      })()
    : null;

  return {
    ...base,
    vibe: d.vibe,
    weatherVerdict: d.weatherVerdict,
    season: {
      level: d.season.level,
      crowds: d.season.crowds,
      prices: d.season.prices,
      summary: d.season.summary,
      sources: verifiedSources(d.season.sourceUrls, search),
    },
    // Unsourced events are dropped rather than shown as fact.
    events: d.events
      .map((e) => ({ ...e, sources: verifiedSources(e.sourceUrls, search) }))
      .filter((e) => e.sources.length)
      .slice(0, 5)
      .map((e) => ({ name: e.name, kind: e.kind, impact: e.impact, when: e.when, detail: e.detail, sources: e.sources })),
    visa,
    // Unsourced answers to the traveler's restrictions are kept (they matter) but marked unknown.
    restrictions: d.restrictions.map((r) => {
      const sources = verifiedSources(r.sourceUrls, search);
      const unverified = !sources.length && r.impact !== "unknown" && r.impact !== "blocker";
      return {
        concern: r.concern,
        impact: unverified ? ("unknown" as const) : r.impact,
        notes: unverified ? `${r.notes} (Couldn't verify this with a source — check with the embassy.)` : r.notes,
        sources,
      };
    }),
    overall: d.overall,
  };
}

async function climateFor(place: Place, timing: Timing, emit: ProgressFn): Promise<Climate | null> {
  const window = forecastWindow(timing);
  emit({
    type: "status",
    message: window
      ? `Your trip is soon — fetching the forecast for ${place.name}…`
      : `Crunching 10 years of weather data for ${place.name}…`,
  });
  try {
    return window ? await getForecast(place.lat, place.lng, window) : await getClimateNormals(place.lat, place.lng, monthsOf(timing));
  } catch (e) {
    emit({ type: "status", message: `Weather data unavailable for ${place.name} (${(e as Error).message})` });
    return null;
  }
}

/** Geocode → climate → deterministic score. Cheap; no AI. */
export async function locateAndScore(query: string, timing: Timing, profile: Profile, emit: ProgressFn) {
  emit({ type: "status", message: `Finding ${query} on the map…` });
  const place = await geocode(query);
  if (!place) throw new UserFacingError(`Couldn't find "${query}". Try "City, Country".`);
  const climate = await climateFor(place, timing, emit);
  const weatherFit = climate ? scoreWeather(climate, profile.weather, profile.units) : null;
  return { place, climate, weatherFit };
}

/** Full fit card: location + weather + AI research (season, events, visa, verdict). Cached. */
export async function researchFit(
  base: { place: Place; climate: Climate | null; weatherFit: WeatherFit | null },
  timing: Timing,
  profile: Profile,
  emit: ProgressFn,
): Promise<FitCard> {
  const { place, climate, weatherFit } = base;
  const domestic = Boolean(place.countryCode && profile.passports.includes(place.countryCode));
  const docs: TravelDocs = profile.travelDocs ?? EMPTY_TRAVEL_DOCS;
  const checkOpts: FitCheckOpts = {
    domestic,
    passports: profile.passports,
    weatherLabel: weatherFit?.label ?? null,
    docCount: describeDocList(docs).length,
    hasRestrictions: docs.restrictions.trim().length > 0,
    avoidAdvanceVisa: docs.avoidAdvanceVisa,
  };
  const key = cacheKey("fit", {
    v: RESEARCH_VERSION,
    place: [place.name, place.lat.toFixed(2), place.lng.toFixed(2)],
    timing,
    profile,
    climate,
  });
  return cached(key, FIT_CACHE_DAYS, async () => {
    emit({ type: "status", message: `Researching season, events${domestic ? "" : ", and entry rules"} for ${place.name}…` });
    const prompt =
      fitResearchPrompt({
        place,
        timing,
        profileText: describeProfile(profile),
        climate,
        weatherFit,
        domestic,
        passports: profile.passports,
        docsText: describeTravelDocs(docs),
        docCount: checkOpts.docCount,
        hasRestrictions: checkOpts.hasRestrictions,
        avoidAdvanceVisa: docs.avoidAdvanceVisa,
        today: isoDay(new Date()),
      }) + (profile.units === "C" ? "\nWrite any temperatures in °C." : "");
    const { data, searchResults } = await runStructured({
      task: "fit-research",
      system: RESEARCH_SYSTEM,
      prompt,
      schema: FitResearchAi,
      webSearch: { maxUses: 8 },
      effort: "medium",
      onProgress: emit,
      fixtureInput: { place, docs: describeDocList(docs), restrictions: docs.restrictions, ...checkOpts },
      check: (d, ctx) => checkFitResearch(d, ctx, checkOpts),
    });
    return buildCard(data, searchResults, base);
  });
}

function cardSummary(c: FitCard): string {
  const v = c.visa ? `${c.visa.best.status.replace(/_/g, " ")}${c.visa.best.leadTime ? ` (${c.visa.best.leadTime})` : ""}` : "domestic";
  return `- ${c.place.name}: weather ${c.weatherFit ? `${c.weatherFit.score}/100 ${LABEL_TEXT[c.weatherFit.label]}` : "unknown"}; ${c.season.level} season, ${c.season.crowds} crowds, ${c.season.prices} prices; visa: ${v}; overall ${LABEL_TEXT[c.overall.label]} — ${c.overall.summary}`;
}

export async function compareCards(cards: FitCard[], timing: Timing, profile: Profile, emit: ProgressFn) {
  if (cards.length < 2) return null;
  emit({ type: "status", message: "Comparing your options side by side…" });
  const names = cards.map((c) => c.place.name);
  const { data } = await runStructured({
    task: "fit-compare",
    system: RESEARCH_SYSTEM,
    prompt: comparisonPrompt({ profileText: describeProfile(profile), timing, cardsText: cards.map(cardSummary).join("\n") }),
    schema: ComparisonAi,
    effort: "low",
    maxTokens: 4000,
    fixtureInput: { names, cards },
    check: (d) => (d.pick !== null && !names.includes(d.pick) ? [`pick must be null or one of: ${names.join(" | ")}`] : []),
  });
  return data;
}

/**
 * Suggest alternatives: Claude proposes ~6 similar places, real climate data filters
 * them by the traveler's weather preferences, and the best 2–4 get full fit cards.
 */
export async function findAlternatives(
  original: FitCard[],
  originalQueries: string[],
  timing: Timing,
  profile: Profile,
  emit: ProgressFn,
): Promise<{ cards: FitCard[]; note: string | null }> {
  emit({ type: "status", message: "Looking for similar places that fit better…" });
  const taken = new Set([...original.map((c) => c.place.name.toLowerCase()), ...originalQueries.map((q) => q.toLowerCase())]);
  const { data } = await runStructured({
    task: "fit-alternatives",
    system: RESEARCH_SYSTEM,
    prompt: alternativesPrompt({
      profileText: describeProfile(profile),
      docsText: describeTravelDocs(profile.travelDocs ?? EMPTY_TRAVEL_DOCS),
      timing,
      original: original.length
        ? original.map((c) => ({ name: c.place.name, why: c.overall.summary }))
        : originalQueries.map((q) => ({ name: q, why: "couldn't be researched" })),
    }),
    schema: AlternativesAi,
    effort: "medium",
    maxTokens: 8000,
    fixtureInput: { original: originalQueries },
    check: (d) => {
      const p: string[] = [];
      if (d.alternatives.length < 3) p.push("suggest at least 4 alternatives");
      const dup = d.alternatives.filter((a) => taken.has(a.name.toLowerCase()));
      if (dup.length) p.push(`don't repeat the original options: ${dup.map((a) => a.name).join(", ")}`);
      return p;
    },
  });

  // Score each suggestion on real climate data (sequential: geocoder is rate-limited).
  const scored: { base: Awaited<ReturnType<typeof locateAndScore>>; why: string }[] = [];
  for (const alt of data.alternatives.slice(0, 8)) {
    try {
      const base = await locateAndScore(alt.name, timing, profile, emit);
      if (taken.has(base.place.name.toLowerCase())) continue;
      taken.add(base.place.name.toLowerCase());
      scored.push({ base, why: alt.whySimilar });
    } catch {
      emit({ type: "status", message: `Skipping ${alt.name} (couldn't locate it)` });
    }
  }
  scored.sort((a, b) => (b.base.weatherFit?.score ?? -1) - (a.base.weatherFit?.score ?? -1));
  const fitting = scored.filter((s) => s.base.weatherFit && RANK[s.base.weatherFit.label] >= RANK.good);
  const chosen = (fitting.length >= 2 ? fitting : scored).slice(0, 3);
  for (const s of scored.filter((s) => !chosen.includes(s))) {
    emit({ type: "status", message: `Ruled out ${s.base.place.name}: weather fit ${s.base.weatherFit?.score ?? "unknown"}/100` });
  }

  const cards = await Promise.all(chosen.map((s) => researchFit(s.base, timing, profile, emit)));
  const note =
    fitting.length >= 2
      ? data.note
      : `${data.note} Few similar places have weather you'd love at this time of year, so these are the closest matches.`;
  return { cards, note };
}

/** Phase 1 end to end. */
export async function runFit(
  candidates: string[],
  timing: Timing,
  profile: Profile,
  emit: ProgressFn,
  opts: { forceAlternatives?: boolean } = {},
): Promise<FitResult> {
  const failures: FitResult["failures"] = [];
  const settled = await Promise.allSettled(
    candidates.map(async (q) => researchFit(await locateAndScore(q, timing, profile, emit), timing, profile, emit)),
  );
  const cards: FitCard[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") cards.push(s.value);
    else failures.push({ query: candidates[i], error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
  });
  if (!cards.length && failures.every((f) => !f.error.startsWith("Couldn't find"))) {
    // Nothing worked for a non-"not found" reason (API key, network…): surface it.
    throw new Error(failures[0]?.error ?? "Research failed");
  }

  const comparison = await compareCards(cards, timing, profile, emit);
  let alternatives: FitCard[] = [];
  let alternativesNote: string | null = null;
  // Suggest alternatives when nothing fits — but not when nothing could even be located.
  if (opts.forceAlternatives || (cards.length > 0 && !cards.some(isGoodFit))) {
    const alt = await findAlternatives(cards, candidates, timing, profile, emit);
    alternatives = alt.cards;
    alternativesNote = alt.note;
  }
  emit({ type: "status", message: "Done." });
  return { candidates: cards, comparison, alternatives, alternativesNote, failures };
}
