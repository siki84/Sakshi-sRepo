import { cached, cacheKey } from "../cache";
import { fetchJson, HttpError, isMockExternal } from "../http";
import type { Climate, DailyForecast } from "../schemas";
import { MONTHS } from "../timing";
import { mockClimate, mockDailyForecast } from "./fixtures";

export type DailySeries = {
  time: string[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_sum: (number | null)[];
  dew_point_2m_mean?: (number | null)[];
  relative_humidity_2m_mean?: (number | null)[];
  daylight_duration?: (number | null)[];
  sunshine_duration?: (number | null)[];
};

const BASE_VARS = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "daylight_duration", "sunshine_duration"];
const HUMIDITY_VARS = ["dew_point_2m_mean", "relative_humidity_2m_mean"];
const NORMAL_YEARS = 10;

const round1 = (n: number) => Math.round(n * 10) / 10;

function mean(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Collapse a daily series into one climate summary, using only days in `months` (all if omitted). */
export function aggregateDaily(d: DailySeries, months?: number[]): Omit<Climate, "source" | "basis"> {
  const idx = d.time
    .map((t, i) => [Number(t.slice(5, 7)), i] as const)
    .filter(([m]) => !months || months.includes(m))
    .map(([, i]) => i);
  if (!idx.length) throw new Error("No weather data for the requested period");
  const pick = <K extends keyof DailySeries>(k: K) => idx.map((i) => (d[k] as (number | null)[] | undefined)?.[i] ?? null);

  const precip = pick("precipitation_sum").filter((x): x is number => x !== null);
  const rainyShare = precip.length ? precip.filter((p) => p >= 1).length / precip.length : 0;
  const dew = mean(pick("dew_point_2m_mean"));
  const rh = mean(pick("relative_humidity_2m_mean"));
  const daylight = mean(pick("daylight_duration"));
  const sunshine = mean(pick("sunshine_duration"));

  return {
    avgHighF: round1(mean(pick("temperature_2m_max")) ?? NaN),
    avgLowF: round1(mean(pick("temperature_2m_min")) ?? NaN),
    rainyDaysPerMonth: round1(rainyShare * 30),
    precipMmPerMonth: Math.round((mean(precip) ?? 0) * 30),
    dewPointF: dew === null ? null : round1(dew),
    humidityPct: rh === null ? null : Math.round(rh),
    daylightHours: daylight === null ? null : round1(daylight / 3600),
    sunshineHours: sunshine === null ? null : round1(sunshine / 3600),
  };
}

async function fetchDaily(base: string, params: Record<string, string>): Promise<DailySeries> {
  const build = (vars: string[]) =>
    `${base}?${new URLSearchParams({ ...params, daily: vars.join(","), temperature_unit: "fahrenheit", precipitation_unit: "mm", timezone: "auto" })}`;
  try {
    return (await fetchJson<{ daily: DailySeries }>(build([...BASE_VARS, ...HUMIDITY_VARS]), { timeoutMs: 30_000 })).daily;
  } catch (e) {
    // Older models/regions may lack humidity aggregates; degrade gracefully.
    if (e instanceof HttpError && e.status === 400) {
      return (await fetchJson<{ daily: DailySeries }>(build(BASE_VARS), { timeoutMs: 30_000 })).daily;
    }
    throw e;
  }
}

function describeMonths(months: number[]): string {
  return months.length === 1 ? MONTHS[months[0] - 1] : months.map((m) => MONTHS[m - 1].slice(0, 3)).join("–");
}

/** Typical weather for these months, from the last 10 full years of reanalysis data. */
export async function getClimateNormals(lat: number, lng: number, months: number[], now = new Date()): Promise<Climate> {
  const endYear = now.getUTCFullYear() - 1;
  const startYear = endYear - NORMAL_YEARS + 1;
  const basis = `${describeMonths(months)}, ${startYear}–${endYear} average`;
  if (isMockExternal()) return { source: "normals", basis, ...mockClimate(lat, months) };

  const key = cacheKey("climate", { lat: lat.toFixed(2), lng: lng.toFixed(2), months, startYear });
  return cached(key, 180, async () => {
    const daily = await fetchDaily("https://archive-api.open-meteo.com/v1/archive", {
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      start_date: `${startYear}-01-01`,
      end_date: `${endYear}-12-31`,
    });
    return { source: "normals" as const, basis, ...aggregateDaily(daily, months) };
  });
}

/** Day-by-day forecast summarized over the window (only for trips ≤ 14 days out). */
export async function getForecast(lat: number, lng: number, window: { start: string; end: string }): Promise<Climate> {
  const basis = `Forecast for ${window.start} to ${window.end}`;
  if (isMockExternal()) {
    const m = Number(window.start.slice(5, 7));
    return { source: "forecast", basis, ...mockClimate(lat, [m]) };
  }
  const key = cacheKey("forecast", { lat: lat.toFixed(2), lng: lng.toFixed(2), window, hour: new Date().toISOString().slice(0, 13) });
  return cached(key, 0.25, async () => {
    const daily = await fetchDaily("https://api.open-meteo.com/v1/forecast", {
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      start_date: window.start,
      end_date: window.end,
    });
    const agg = aggregateDaily(daily);
    return { source: "forecast" as const, basis, ...agg };
  });
}

/** Day-by-day forecast (only meaningful within ~16 days). */
export async function getDailyForecast(
  lat: number,
  lng: number,
  window: { start: string; end: string },
): Promise<DailyForecast[]> {
  if (isMockExternal()) return mockDailyForecast(lat, window);
  const key = cacheKey("forecast-daily", { lat: lat.toFixed(2), lng: lng.toFixed(2), window, hour: new Date().toISOString().slice(0, 13) });
  return cached(key, 0.25, async () => {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      start_date: window.start,
      end_date: window.end,
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
      temperature_unit: "fahrenheit",
      precipitation_unit: "mm",
      timezone: "auto",
    });
    const { daily } = await fetchJson<{
      daily: {
        time: string[];
        temperature_2m_max: (number | null)[];
        temperature_2m_min: (number | null)[];
        precipitation_sum: (number | null)[];
        precipitation_probability_max?: (number | null)[];
      };
    }>(`https://api.open-meteo.com/v1/forecast?${params}`);
    return daily.time.map((date, i) => ({
      date,
      highF: Math.round(daily.temperature_2m_max[i] ?? NaN),
      lowF: Math.round(daily.temperature_2m_min[i] ?? NaN),
      precipMm: Math.round((daily.precipitation_sum[i] ?? 0) * 10) / 10,
      precipProb: daily.precipitation_probability_max?.[i] ?? null,
    }));
  });
}
