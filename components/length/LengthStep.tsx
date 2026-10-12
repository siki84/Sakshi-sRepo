"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DailyForecast, LengthState, Timing } from "@/lib/schemas";
import { closestOption } from "@/lib/length";
import { MONTHS, isoDay } from "@/lib/timing";
import { formatTemp } from "@/lib/units";
import { computeLengthAction, confirmLengthAction, previewForecastAction } from "@/app/trip/[id]/actions";

type Key = "min" | "ideal" | "generous";
const TITLES: Record<Key, string> = { min: "Minimum", ideal: "Ideal", generous: "Generous" };

function addDays(start: string, n: number) {
  return isoDay(new Date(new Date(`${start}T00:00:00Z`).getTime() + n * 86_400_000));
}

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function LengthStep({
  tripId,
  initial,
  stale,
  timing,
  units,
  names,
}: {
  tripId: string;
  initial: LengthState | null;
  stale: boolean;
  timing: Timing;
  units: "F" | "C";
  /** Activity id → name, for "skips"/"adds" lists. */
  names: Record<string, string>;
}) {
  const router = useRouter();
  const [state, setState] = useState<LengthState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [computing, startCompute] = useTransition();
  const [confirming, startConfirm] = useTransition();
  const [days, setDays] = useState<number | null>(initial?.chosenDays ?? initial?.options.ideal.days ?? null);
  const [startDate, setStartDate] = useState<string>(initial?.startDate ?? (timing.kind === "dates" ? timing.start : ""));
  const [forecast, setForecast] = useState<DailyForecast[] | null>(initial?.forecast ?? null);
  const autoRan = useRef(false);

  const compute = () =>
    startCompute(async () => {
      setError(null);
      const res = await computeLengthAction(tripId);
      if (!res.ok) return setError(res.error);
      setState(res.length);
      setDays((d) => d ?? res.length.options.ideal.days);
      router.refresh();
    });

  // First visit: work it out straight away.
  useEffect(() => {
    if (!initial && !autoRan.current) {
      autoRan.current = true;
      compute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the forecast whenever the dates change (server decides if it's near enough).
  useEffect(() => {
    if (!startDate || !days) {
      setForecast(null);
      return;
    }
    let cancelled = false;
    previewForecastAction(tripId, startDate, days).then((res) => {
      if (cancelled) return;
      if (res.ok) setForecast(res.forecast);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, startDate, days]);

  if (!state) {
    return (
      <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-medium">How long should this trip be?</h2>
        <p className="text-sm text-slate-600">{computing ? "Working it out from your picks and pace…" : "We'll size the trip from what you kept."}</p>
        {!computing && (
          <button type="button" onClick={compute} className="rounded-lg bg-slate-900 px-5 py-2 text-white">
            Work out my trip length
          </button>
        )}
        {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      </section>
    );
  }

  const closest = closestOption(state.options, state.approxDays);
  const ideal = state.options.ideal;
  const minIds = new Set(state.options.min.itemIds);
  const skips = ideal.itemIds.filter((id) => !minIds.has(id)).map((id) => names[id]).filter(Boolean);
  const adds = state.options.generous.itemIds.filter((id) => !ideal.itemIds.includes(id)).map((id) => names[id]).filter(Boolean);
  const endDate = startDate && days ? addDays(startDate, days - 1) : null;
  const dateMonth = startDate ? Number(startDate.slice(5, 7)) : null;
  const monthMismatch = timing.kind === "month" && dateMonth !== null && dateMonth !== timing.month;
  const today = isoDay(new Date());

  return (
    <div className="space-y-5">
      {stale && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Your picks changed since this was worked out.
          <button type="button" onClick={compute} disabled={computing} className="rounded bg-amber-600 px-3 py-1 text-white disabled:opacity-50">
            {computing ? "Recalculating…" : "Recalculate"}
          </button>
        </div>
      )}

      <section className="space-y-2 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-medium" data-testid="length-headline">
          {state.advice.headline}
        </h2>
        <p className="text-sm text-slate-600">
          Based on {state.selectionIds.length} {state.usedTopRanked ? "picks (your kept ones plus top-ranked ideas)" : "kept picks"}, your pace
          (~{ideal.breakdown.hoursPerDay}h of activities a day), {ideal.breakdown.dayTrips} day trip{ideal.breakdown.dayTrips === 1 ? "" : "s"}
          {ideal.breakdown.travelDays ? `, ${ideal.breakdown.travelDays} travel day${ideal.breakdown.travelDays === 1 ? "" : "s"} between stops` : ""}
          {ideal.breakdown.arrivalBuffer ? ", and a day of arrival/departure buffer" : ""}.
        </p>
        {state.advice.approxNote && <p className="text-sm text-slate-700">🗓️ {state.advice.approxNote}</p>}
      </section>

      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Trip length options">
        {(["min", "ideal", "generous"] as const).map((k) => {
          const o = state.options[k];
          const selected = days === o.days;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${TITLES[k]}: ${o.days} ${o.days === 1 ? "day" : "days"}`}
              onClick={() => setDays(o.days)}
              className={`flex flex-col gap-2 rounded-xl bg-white p-4 text-left shadow-sm ring-1 ${selected ? "ring-2 ring-emerald-600" : "ring-slate-200 hover:ring-slate-400"}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-slate-600">{TITLES[k]}</span>
                {k === "ideal" && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">Recommended</span>}
                {closest === k && state.approxDays !== null && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-900">≈ your {state.approxDays} days</span>
                )}
              </div>
              <div className="text-3xl font-semibold">
                {o.days} <span className="text-base font-normal text-slate-500">{o.days === 1 ? "day" : "days"}</span>
              </div>
              <p className="text-sm text-slate-700">{state.advice[k]}</p>
              {k === "min" && skips.length > 0 && (
                <p className="text-xs text-slate-500">Skips: {skips.slice(0, 5).join(", ")}{skips.length > 5 ? ` +${skips.length - 5} more` : ""}</p>
              )}
              {k === "generous" && adds.length > 0 && (
                <p className="text-xs text-slate-500">Adds: {adds.slice(0, 5).join(", ")}{adds.length > 5 ? ` +${adds.length - 5} more` : ""}</p>
              )}
            </button>
          );
        })}
      </div>

      <section className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="days" className="font-medium">
            Number of days
          </label>
          <input
            id="days"
            type="number"
            min={1}
            max={60}
            value={days ?? ""}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              setDays(n >= 1 && n <= 60 ? n : null);
            }}
            className="w-20 rounded-lg border border-slate-300 px-2 py-1.5"
          />
          {days !== null && days < state.options.min.days && (
            <span className="text-amber-700">That&apos;s tighter than our minimum — expect to cut must-sees.</span>
          )}
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="font-medium">Exact dates <span className="font-normal text-slate-500">(optional)</span></div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              Start
              <input
                type="date"
                aria-label="Start date"
                min={today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5"
              />
            </label>
            {endDate && <span className="text-slate-600">→ ends {fmtDate(endDate)}</span>}
            {startDate && (
              <button type="button" onClick={() => setStartDate("")} className="text-xs text-slate-500 underline">
                Clear
              </button>
            )}
          </div>
          {monthMismatch && (
            <p className="text-xs text-amber-700">
              Heads up: these dates are in {MONTHS[dateMonth! - 1]}, but we checked the weather for {MONTHS[(timing as { month: number }).month - 1]}.
              You can re-check on step 1.
            </p>
          )}
        </div>

        {forecast && forecast.length > 0 && (
          <div className="space-y-1.5" aria-label="Forecast">
            <div className="text-sm font-medium">Forecast for your dates</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {forecast.map((f) => (
                <div key={f.date} className={`min-w-20 rounded-lg p-2 text-center text-xs ring-1 ${f.precipProb !== null && f.precipProb >= 60 ? "bg-sky-50 ring-sky-200" : "bg-slate-50 ring-slate-200"}`}>
                  <div className="font-medium">{fmtDate(f.date).split(",")[0]}</div>
                  <div>{fmtDate(f.date).split(", ")[1]}</div>
                  <div className="mt-1 text-sm">{f.precipProb !== null && f.precipProb >= 60 ? "🌧️" : f.precipMm > 1 ? "🌦️" : "☀️"}</div>
                  <div>
                    {formatTemp(f.highF, units)} / {formatTemp(f.lowF, units)}
                  </div>
                  {f.precipProb !== null && <div className="text-slate-500">{f.precipProb}% rain</div>}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Source:{" "}
              <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline">
                Open-Meteo
              </a>{" "}
              forecast. Your plan will put outdoor things on the drier days.
            </p>
          </div>
        )}
        {startDate && !forecast && (
          <p className="text-xs text-slate-500">Forecasts appear when the trip is within 2 weeks; until then we plan around typical weather.</p>
        )}
      </section>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button
          type="button"
          disabled={!days || confirming}
          onClick={() =>
            startConfirm(async () => {
              const res = await confirmLengthAction({ tripId, days: days!, startDate: startDate || null });
              if (res.ok) router.push(`/trip/${tripId}/plan`);
              else setError(res.error);
            })
          }
          className="w-full rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
        >
          {confirming ? "Saving…" : days ? `Plan my ${days} days →` : "Choose a length"}
        </button>
      </div>
    </div>
  );
}
