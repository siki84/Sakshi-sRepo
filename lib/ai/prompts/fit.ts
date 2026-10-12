import type { Climate, Place, Timing, WeatherFit } from "../../schemas";
import { describeLength, describeTiming } from "../../timing";
import { LABEL_TEXT } from "../../weather/score";
import { countryName } from "../../countries";

export const RESEARCH_SYSTEM = `You are a meticulous travel researcher helping one specific traveler decide where to go.
Principles:
- Be specific and current. Prefer recent first-hand sources (Reddit threads, local guides, travel blogs, official tourism and government sites) over generic listicles.
- Honesty over confidence. If sources disagree or you're unsure (especially visa rules or seasonal closures), say so and lower your confidence. Never present a guess as fact.
- Only cite URLs that appeared in your web search results. Never invent or guess a URL.
- Write for a traveler, not a travel agent: short, concrete, no hype.
- Respond with JSON matching the requested schema.`;

export function fitResearchPrompt(args: {
  place: Place;
  timing: Timing;
  profileText: string;
  climate: Climate | null;
  weatherFit: WeatherFit | null;
  domestic: boolean;
  passports: string[];
  docsText: string;
  docCount: number;
  hasRestrictions: boolean;
  avoidAdvanceVisa: boolean;
  today: string;
}): string {
  const { place, timing, climate, weatherFit } = args;
  const weatherBlock =
    climate && weatherFit
      ? `Computed weather (${climate.basis}): highs ${climate.avgHighF}°F, lows ${climate.avgLowF}°F, rain on ~${climate.rainyDaysPerMonth} days/month (${climate.precipMmPerMonth} mm), dew point ${climate.dewPointF ?? "n/a"}°F, humidity ${climate.humidityPct ?? "n/a"}%, daylight ${climate.daylightHours ?? "n/a"} h.
Computed weather fit for this traveler: ${weatherFit.score}/100 — ${LABEL_TEXT[weatherFit.label]}.
Reasons: ${weatherFit.reasons.map((r) => r.text).join("; ")}.
Your weatherVerdict must agree with these numbers; do not re-score the weather.`
      : "Weather data was unavailable; say so in weatherVerdict and do not guess numbers.";

  const visaBlock = args.domestic
    ? "This is a domestic trip for this traveler (they hold a passport for the destination country). Set visa to null."
    : `Check entry requirements for EACH of these passports: ${args.passports.map((c) => `${countryName(c)} (${c})`).join(", ")}.
Include exactly one perPassport entry per passport. Prefer official government sources (the destination's immigration or foreign-ministry site, or the traveler's government travel advice). Note any pre-travel authorization (ETA, ETIAS, K-ETA, ESTA-style) and its lead time. If the trip length is longer than the permitted stay, say so clearly. If rules are changing or unclear, set confidence to "low" and say why.
${args.docCount ? `Also check whether each of the traveler's other documents (residence permits, visas held — listed under Traveler) grants or eases entry here; many countries accept e.g. a valid US/UK/Schengen visa or residence permit. Include exactly one otherDocuments entry per listed document (${args.docCount} total).` : "The traveler listed no other documents; leave otherDocuments empty."}`;

  return `Today is ${args.today}.
Destination: ${place.name}${place.countryCode ? ` (${countryName(place.countryCode)})` : ""}
Trip timing: ${describeTiming(timing)}
Trip length: ${describeLength(timing)}

Traveler:
${args.profileText}
${args.docsText}

${weatherBlock}

Research and report:
1. Season: is ${describeTiming(timing)} peak, shoulder, or off-season here? Crowds, price pressure, anything closed or especially good.
2. Events: notable festivals, holidays, closures, hazards (monsoon, hurricanes, heat waves, wildfire smoke), or seasonal activities in that window. Skip anything you can't source.
3. Visa / entry: ${visaBlock}
4. Restrictions: ${args.hasRestrictions ? "for EACH restriction/concern the traveler mentioned, say whether it affects entering or visiting this destination (blocker / caution / ok / unknown) and what to do. Be careful and factual; if you can't find a reliable answer, use \"unknown\" and say who to ask (e.g. the embassy)." : "none mentioned; leave restrictions empty."}
5. Overall: an honest bottom line for this traveler. The overall label must not be better than the weather fit label (${weatherFit ? LABEL_TEXT[weatherFit.label] : "unknown"}); downgrade it further for serious visa hurdles, blockers among their restrictions, closures, or hazards.${args.avoidAdvanceVisa ? " The traveler only wants places they can enter without applying for a visa in advance: if the easiest option requires a visa applied for in advance, the overall label must be \"poor\"." : ""}

Use web search efficiently — a handful of targeted queries (e.g. "site:reddit.com ${place.name} in ${describeTiming(timing)}", "${place.name} festivals ${describeTiming(timing)}", official visa requirements).`;
}

export function comparisonPrompt(args: { profileText: string; timing: Timing; cardsText: string }): string {
  return `Traveler:
${args.profileText}

Trip timing: ${describeTiming(args.timing)}
Trip length: ${describeLength(args.timing)}

Options (already researched):
${args.cardsText}

Compare them side by side for this traveler: weather fit first, then season/crowds, then visa hassle, then whether the trip length suits each place (travel time from home, enough to do). Be direct about trade-offs. Set "pick" to the exact name of the better option, or null if neither is a good fit or it's genuinely a toss-up.`;
}

export function alternativesPrompt(args: {
  profileText: string;
  docsText: string;
  timing: Timing;
  original: { name: string; why: string }[];
}): string {
  return `Traveler:
${args.profileText}

Trip timing: ${describeTiming(args.timing)}
Trip length: ${describeLength(args.timing)}

They were considering: ${args.original.map((o) => `${o.name} (${o.why})`).join("; ")}.
Their other documents and restrictions:
${args.docsText}

Those aren't a great fit. Suggest 6 alternative destinations that keep the same vibe, region, or trip type, but are likely to have weather this traveler enjoys in ${describeTiming(args.timing)} are realistic to enter given their passport(s), other documents, and restrictions, and make sense for the trip length given travel time from their home city.
Each name must be a specific, geocodable place ("City, Country" or "Island/Region, Country"), not a whole country. Don't repeat the original options. The app will check real climate data for each and keep only the ones that fit.`;
}
