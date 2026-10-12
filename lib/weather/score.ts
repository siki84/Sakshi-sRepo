import type { Climate, FitLabel, Tolerance, WeatherFit, WeatherPrefs } from "../schemas";
import { formatTemp } from "../units";

/**
 * Deterministic weather fit: 100 minus penalties for each way the climate falls outside
 * the traveler's stated preferences. The model never computes this — it only narrates it.
 */

const WEIGHT: Record<Tolerance, number> = { love: 0, ok: 0.4, dislike: 1.2, hate: 2.5 };
const MUGGY_DEW_F = 60; // dew point above which air starts to feel sticky
const OK_RAINY_DAYS = 5; // rainy days/month most people barely notice

export function labelFor(score: number): FitLabel {
  if (score >= 80) return "great";
  if (score >= 60) return "good";
  if (score >= 40) return "mixed";
  return "poor";
}

export const LABEL_TEXT: Record<FitLabel, string> = {
  great: "Great fit",
  good: "Good fit",
  mixed: "Mixed",
  poor: "Poor fit",
};

const feel = (t: Tolerance) =>
  ({ love: "you love that", ok: "you said that's fine", dislike: "you dislike that", hate: "you want to avoid that" })[t];

export function scoreWeather(c: Climate, prefs: WeatherPrefs, units: "F" | "C" = "F"): WeatherFit {
  const reasons: WeatherFit["reasons"] = [];
  let penalty = 0;
  const T = (f: number) => formatTemp(f, units);
  const range = `${T(prefs.idealMinF)}–${T(prefs.idealMaxF)}`;

  // Daytime temperature vs. ideal range.
  const over = c.avgHighF - prefs.idealMaxF;
  const under = prefs.idealMinF - c.avgHighF;
  if (over > 0) {
    penalty += over * 2 * WEIGHT[prefs.heat];
    reasons.push({
      tone: prefs.heat === "love" || over <= 3 ? "neutral" : "bad",
      text: `Highs around ${T(c.avgHighF)} — ${over <= 3 ? "just above" : "above"} your ${range} range (${feel(prefs.heat)})`,
    });
  } else if (under > 0) {
    penalty += under * 2 * WEIGHT[prefs.cold];
    reasons.push({
      tone: prefs.cold === "love" || under <= 3 ? "neutral" : "bad",
      text: `Highs around ${T(c.avgHighF)} — ${under <= 3 ? "just below" : "below"} your ${range} range (${feel(prefs.cold)})`,
    });
  } else {
    reasons.push({ tone: "good", text: `Highs around ${T(c.avgHighF)} — right in your ${range} range` });
  }

  // Cold nights matter a little, for people who dislike cold.
  const coldNight = prefs.idealMinF - 20 - c.avgLowF;
  if (coldNight > 0 && WEIGHT[prefs.cold] > 0) {
    penalty += Math.min(coldNight, 20) * 0.5 * WEIGHT[prefs.cold];
    reasons.push({ tone: "neutral", text: `Chilly nights, lows around ${T(c.avgLowF)}` });
  }

  // Humidity: dew point is the best proxy for "muggy"; fall back to relative humidity.
  const mugginess =
    c.dewPointF !== null ? c.dewPointF - MUGGY_DEW_F : c.humidityPct !== null ? (c.humidityPct - 70) / 2 : null;
  if (mugginess === null) {
    reasons.push({ tone: "neutral", text: "Humidity data unavailable" });
  } else if (mugginess > 0) {
    penalty += mugginess * 2.5 * WEIGHT[prefs.humidity];
    const word = c.dewPointF !== null && c.dewPointF >= 70 ? "Oppressively humid" : mugginess > 5 ? "Humid and sticky" : "A bit humid";
    reasons.push({
      tone: prefs.humidity === "love" || mugginess <= 3 ? "neutral" : "bad",
      text: `${word}${c.dewPointF !== null ? ` (dew point ${T(c.dewPointF)})` : ""} — ${feel(prefs.humidity)}`,
    });
  } else {
    reasons.push({ tone: "good", text: "Comfortable, dry air" });
  }

  // Rain.
  const extraRain = c.rainyDaysPerMonth - OK_RAINY_DAYS;
  const rainy = Math.round(c.rainyDaysPerMonth);
  if (extraRain > 0) {
    penalty += extraRain * 2.5 * WEIGHT[prefs.rain];
    reasons.push({
      tone: prefs.rain === "love" || extraRain <= 2 ? "neutral" : "bad",
      text: `Rain on about ${rainy} days a month — ${feel(prefs.rain)}`,
    });
  } else {
    reasons.push({ tone: "good", text: rainy <= 1 ? "Almost no rain" : `Mostly dry (rain on ~${rainy} days a month)` });
  }

  if (c.daylightHours !== null) {
    reasons.push({ tone: c.daylightHours < 9.5 ? "bad" : "neutral", text: `${c.daylightHours} hours of daylight` });
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, label: labelFor(score), reasons };
}
