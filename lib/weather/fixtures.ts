import type { Climate } from "../schemas";

/**
 * MOCK_EXTERNAL: plausible synthetic climate from latitude + month.
 * Not real data — only used for tests and offline development.
 */
export function mockClimate(lat: number, months: number[]): Omit<Climate, "source" | "basis"> {
  const abs = Math.abs(lat);
  const m = months[0];
  // +1 at local midsummer, −1 at midwinter.
  const season = Math.cos(((m - 7) * Math.PI) / 6) * (lat >= 0 ? 1 : -1);
  const tropical = abs < 24;
  const high = tropical ? 89 + 2 * season : 88 - 0.5 * abs + 0.4 * abs * season;
  const rainy = tropical ? (season > 0.3 ? 19 : 6) : Math.max(1, 7 - 5 * season);
  const dew = tropical ? 74 : 46 + 10 * season;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    avgHighF: r1(high),
    avgLowF: r1(high - (tropical ? 12 : 16)),
    rainyDaysPerMonth: r1(rainy),
    precipMmPerMonth: Math.round(rainy * (tropical ? 14 : 6)),
    dewPointF: r1(dew),
    humidityPct: Math.round(tropical ? 78 : 60 - 8 * season),
    daylightHours: r1(12 + (abs / 90) * 6 * season),
    sunshineHours: r1(tropical ? 6 : 7 + 4 * season),
  };
}
