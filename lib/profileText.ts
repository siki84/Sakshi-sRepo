import { countryName } from "./countries";
import type { Profile } from "./schemas";
import { formatTemp } from "./units";

const TOL = { love: "loves", ok: "is fine with", dislike: "dislikes", hate: "wants to avoid" } as const;
const PACE = ["", "very relaxed", "relaxed", "balanced", "busy", "packed"];

/** Compact, model-readable description of the traveler. */
export function describeProfile(p: Profile): string {
  const w = p.weather;
  const T = (f: number) => formatTemp(f, p.units);
  const who =
    p.travelers.type === "family"
      ? `family of ${p.travelers.groupSize}${p.travelers.kidsAges.length ? ` with kids aged ${p.travelers.kidsAges.join(", ")}` : ""}`
      : p.travelers.type === "friends"
        ? `group of ${p.travelers.groupSize} friends`
        : p.travelers.type === "partner"
          ? "couple"
          : "solo traveler";
  return [
    `Home city: ${p.homeCity}`,
    `Passports: ${p.passports.map((c) => `${countryName(c)} (${c})`).join(", ")}`,
    `Travelers: ${who}`,
    `Pace: ${PACE[p.pace]}`,
    `Weather: ideal daytime highs ${T(w.idealMinF)}–${T(w.idealMaxF)}; ${TOL[w.heat]} hotter weather, ${TOL[w.cold]} colder weather, ${TOL[w.humidity]} humidity, ${TOL[w.rain]} rain.${w.notes ? ` Notes: "${w.notes}"` : ""}`,
  ].join("\n");
}
