import type { Timing } from "./schemas";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY = 86_400_000;
const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Calendar months (1–12) the trip touches. */
export function monthsOf(t: Timing): number[] {
  if (t.kind === "month") return [t.month];
  const out: number[] = [];
  const d = parseDay(t.start);
  const end = parseDay(t.end);
  d.setUTCDate(1);
  while (d <= end && out.length < 12) {
    out.push(d.getUTCMonth() + 1);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export function describeTiming(t: Timing): string {
  if (t.kind === "month") return MONTHS[t.month - 1];
  const s = parseDay(t.start);
  const e = parseDay(t.end);
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
  return `${fmt(s, false)} – ${fmt(e, true)}`;
}

export function tripDays(t: Timing): number | null {
  if (t.kind === "month") return null;
  return Math.round((parseDay(t.end).getTime() - parseDay(t.start).getTime()) / DAY) + 1;
}

/** Forecasts are only meaningful for trips starting within 14 days (Open-Meteo goes 16 days out). */
export const FORECAST_HORIZON_DAYS = 14;

export function forecastWindow(t: Timing, now = new Date()): { start: string; end: string } | null {
  if (t.kind !== "dates") return null;
  const today = parseDay(isoDay(now));
  const start = parseDay(t.start);
  const end = parseDay(t.end);
  const lead = (start.getTime() - today.getTime()) / DAY;
  if (lead > FORECAST_HORIZON_DAYS || end < today) return null;
  const maxEnd = new Date(today.getTime() + 15 * DAY);
  return { start: isoDay(start < today ? today : start), end: isoDay(end > maxEnd ? maxEnd : end) };
}

export function validateTiming(t: Timing, now = new Date()): string | null {
  if (t.kind === "month") return null;
  const s = parseDay(t.start);
  const e = parseDay(t.end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "Enter valid dates";
  if (e < s) return "End date must be on or after the start date";
  if (e < parseDay(isoDay(now))) return "Those dates are in the past";
  if ((e.getTime() - s.getTime()) / DAY > 60) return "Trips are limited to 60 days";
  return null;
}
