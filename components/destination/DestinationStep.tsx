"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Progress } from "@/lib/ai/client";
import type { DestinationState, FitCard, FitResult, Timing, TravelDocs } from "@/lib/schemas";
import { countryName } from "@/lib/countries";
import { TravelDocsEditor, summarizeTravelDocs } from "../TravelDocsEditor";
import { MONTHS, validateTiming } from "@/lib/timing";
import { postSse } from "@/lib/sseClient";
import { confirmDestinationAction } from "@/app/trip/[id]/actions";
import { ProgressLog } from "../ProgressLog";
import { FitCardView } from "./FitCardView";

function defaultTiming(): Timing {
  const m = new Date().getMonth() + 1;
  return { kind: "month", month: (m % 12) + 1 }; // next month
}

const isGood = (c: FitCard) => c.overall.label === "great" || c.overall.label === "good";

export function DestinationStep({
  tripId,
  initial,
  units,
  passports,
  profileDocs,
}: {
  tripId: string;
  initial: DestinationState | null;
  units: "F" | "C";
  passports: string[];
  profileDocs: TravelDocs;
}) {
  const router = useRouter();
  const [a, setA] = useState(initial?.candidates[0] ?? "");
  const [b, setB] = useState(initial?.candidates[1] ?? "");
  const [timing, setTiming] = useState<Timing>(initial?.timing ?? defaultTiming());
  const [result, setResult] = useState<FitResult | null>(initial?.result ?? null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initial?.confirmed?.place.name ?? null);
  const [stops, setStops] = useState<string[]>(initial?.confirmed?.stops ?? []);
  const [stopDraft, setStopDraft] = useState("");
  const [confirming, startConfirm] = useTransition();
  const abort = useRef<AbortController | null>(null);
  // Entry details are confirmed once per trip before research runs.
  const [docs, setDocs] = useState<TravelDocs>(initial?.travelDocs ?? profileDocs);
  const [docsConfirmed, setDocsConfirmed] = useState(Boolean(initial?.travelDocs));
  const [askingDocs, setAskingDocs] = useState(false);
  const [saveDocsToProfile, setSaveDocsToProfile] = useState(true);
  const docsBeforeEdit = useRef<TravelDocs>(docs);
  const openDocs = () => {
    docsBeforeEdit.current = docs;
    setAskingDocs(true);
  };

  const confirmedName = initial?.confirmed?.place.name ?? null;

  async function run(mode: "full" | "alternatives", confirmedDocs?: TravelDocs) {
    const candidates = [a, b].map((s) => s.trim()).filter(Boolean);
    if (!candidates.length) return setError("Enter at least one destination");
    const te = validateTiming(timing);
    if (te) return setError(te);
    setError(null);
    if (mode === "full" && !docsConfirmed && !confirmedDocs) {
      openDocs(); // ask about other visas/restrictions before the first research run
      return;
    }
    const travelDocs = confirmedDocs ?? docs;
    const saveToProfile = Boolean(confirmedDocs) && saveDocsToProfile;
    setRunning(true);
    setProgress([]);
    if (mode === "full") {
      setResult(null);
      setSelected(null);
    }
    abort.current = new AbortController();
    try {
      await postSse(
        `/api/trips/${tripId}/fit`,
        { candidates, timing, mode, travelDocs, saveToProfile },
        (event, data) => {
          if (event === "progress") setProgress((p) => [...p, data as Progress]);
          else if (event === "result") setResult(data as FitResult);
          else if (event === "error") setError((data as { message: string }).message);
        },
        abort.current.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function confirm() {
    if (!selected) return;
    startConfirm(async () => {
      const res = await confirmDestinationAction({ tripId, placeName: selected, stops });
      if (res.ok) router.push(`/trip/${tripId}/interests`);
      else setError(res.error);
    });
  }

  const chooseButton = (card: FitCard) => (
    <button
      type="button"
      onClick={() => setSelected(card.place.name)}
      aria-pressed={selected === card.place.name}
      className={`w-full rounded-lg px-4 py-2 text-sm font-medium ${
        selected === card.place.name ? "bg-emerald-600 text-white" : "bg-slate-900 text-white hover:bg-slate-700"
      }`}
    >
      {selected === card.place.name ? "✓ Selected" : `Choose ${card.place.name.split(",")[0]}`}
    </button>
  );

  const anyGood = result ? [...result.candidates].some(isGood) : false;

  return (
    <div className="space-y-5">
      <form
        className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
        onSubmit={(e) => {
          e.preventDefault();
          run("full");
        }}
      >
        <div>
          <h2 className="text-lg font-medium">Where are you thinking of going?</h2>
          <p className="text-sm text-slate-600">
            One or two places to compare — a city, island, or region. We&apos;ll check weather, season, and entry rules.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder="e.g. Lisbon, Portugal"
            aria-label="First destination"
            className="rounded-lg border border-slate-300 px-3 py-2"
            maxLength={120}
          />
          <input
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder="Optional: something to compare, e.g. Seville"
            aria-label="Second destination"
            className="rounded-lg border border-slate-300 px-3 py-2"
            maxLength={120}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">When?</legend>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Timing type">
            {(["month", "dates"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={timing.kind === k}
                onClick={() =>
                  setTiming(
                    k === "month"
                      ? { kind: "month", month: timing.kind === "dates" ? Number(timing.start.slice(5, 7)) : timing.month }
                      : { kind: "dates", start: "", end: "" },
                  )
                }
                className={`rounded-full px-3 py-1.5 text-sm ring-1 ${timing.kind === k ? "bg-slate-900 text-white ring-slate-900" : "bg-white ring-slate-300"}`}
              >
                {k === "month" ? "Rough month" : "Exact dates"}
              </button>
            ))}
          </div>
          {timing.kind === "month" ? (
            <select
              aria-label="Month"
              value={timing.month}
              onChange={(e) => setTiming({ kind: "month", month: Number(e.target.value) })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="date"
                aria-label="Start date"
                value={timing.start}
                onChange={(e) => setTiming({ ...timing, start: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <span>to</span>
              <input
                type="date"
                aria-label="End date"
                value={timing.end}
                onChange={(e) => setTiming({ ...timing, end: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
          )}
        </fieldset>

        {docsConfirmed && !askingDocs && (
          <p className="text-sm text-slate-600" data-testid="entry-summary">
            <span className="font-medium">Entry details:</span> {passports.map(countryName).join(" + ")} passport
            {passports.length > 1 ? "s" : ""} · {summarizeTravelDocs(docs)}{" "}
            <button type="button" onClick={openDocs} className="underline">
              Edit
            </button>
          </p>
        )}

        {askingDocs && (
          <section
            className="space-y-4 rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200"
            aria-label="Visa and travel restrictions check"
          >
            <div>
              <h3 className="font-medium">Before we research: anything else that affects where you can go?</h3>
              <p className="text-sm text-slate-700">
                We&apos;ll check entry rules for your {passports.map(countryName).join(" and ")} passport
                {passports.length > 1 ? "s" : ""}. Other visas, residence permits, or restrictions can change the answer.
              </p>
            </div>
            <TravelDocsEditor value={docs} onChange={setDocs} passports={passports} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saveDocsToProfile} onChange={(e) => setSaveDocsToProfile(e.target.checked)} />
              Also save these to my profile for future trips
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={running}
                onClick={() => {
                  setDocsConfirmed(true);
                  setAskingDocs(false);
                  run("full", docs);
                }}
                className="rounded-lg bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
              >
                Looks right — start research
              </button>
              {docsConfirmed && (
                <button
                  type="button"
                  onClick={() => {
                    setDocs(docsBeforeEdit.current);
                    setAskingDocs(false);
                  }}
                  className="text-sm text-slate-600 underline"
                >
                  Cancel
                </button>
              )}
            </div>
          </section>
        )}

        <div className={`flex flex-wrap items-center gap-3 ${askingDocs ? "hidden" : ""}`}>
          <button
            disabled={running}
            className="rounded-lg bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {running ? "Researching…" : result ? "Re-run comparison" : b.trim() ? "Compare" : "Check fit"}
          </button>
          {running && (
            <button type="button" onClick={() => abort.current?.abort()} className="text-sm text-slate-500 underline">
              Cancel
            </button>
          )}
          {confirmedName && !running && (
            <span className="text-sm text-slate-500">
              Currently planning: <strong>{confirmedName}</strong>
            </span>
          )}
        </div>
        {error && (
          <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">
            {error}
          </p>
        )}
      </form>

      <ProgressLog items={progress} running={running} />

      {result && (
        <div className="space-y-5">
          {result.failures.map((f) => (
            <p key={f.query} className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              {f.query}: {f.error}
            </p>
          ))}

          {result.comparison && (
            <section className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200" aria-label="Comparison">
              <h2 className="font-medium">
                Side by side{result.comparison.pick ? `: ${result.comparison.pick} comes out ahead` : ""}
              </h2>
              <p className="mt-1 text-sm text-slate-700">{result.comparison.summary}</p>
            </section>
          )}

          <div className={`grid gap-4 ${result.candidates.length > 1 ? "md:grid-cols-2" : ""}`}>
            {result.candidates.map((card) => (
              <FitCardView
                key={card.place.name}
                card={card}
                units={units}
                highlight={result.comparison?.pick === card.place.name}
                action={chooseButton(card)}
              />
            ))}
          </div>

          {result.alternatives.length > 0 ? (
            <section className="space-y-3" aria-label="Alternatives">
              <div>
                <h2 className="text-lg font-medium">
                  {anyGood ? "Other places worth a look" : "Neither is a great fit — these might suit you better"}
                </h2>
                {result.alternativesNote && <p className="text-sm text-slate-600">{result.alternativesNote}</p>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {result.alternatives.map((card) => (
                  <FitCardView key={card.place.name} card={card} units={units} action={chooseButton(card)} />
                ))}
              </div>
            </section>
          ) : (
            !running && (
              <button type="button" onClick={() => run("alternatives")} className="text-sm text-slate-600 underline">
                Show me similar alternatives anyway
              </button>
            )
          )}

          {selected && (
            <section
              className="sticky bottom-0 -mx-4 space-y-3 border-t border-slate-200 bg-white/95 p-4 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border-0 sm:ring-1 sm:ring-slate-200"
              aria-label="Confirm destination"
            >
              <div className="text-sm">
                Going to <strong>{selected}</strong>
                {stops.length > 0 && <> → {stops.join(" → ")}</>}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-600">Make it a multi-city route (optional)</summary>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {stops.map((s) => (
                    <span key={s} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
                      {s}
                      <button type="button" aria-label={`Remove ${s}`} onClick={() => setStops(stops.filter((x) => x !== s))}>
                        ✕
                      </button>
                    </span>
                  ))}
                  <input
                    value={stopDraft}
                    onChange={(e) => setStopDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = stopDraft.trim();
                        if (v && !stops.includes(v) && stops.length < 5) setStops([...stops, v]);
                        setStopDraft("");
                      }
                    }}
                    placeholder="Add a stop, press Enter"
                    aria-label="Add a stop"
                    className="rounded-lg border border-slate-300 px-3 py-1.5"
                  />
                </div>
              </details>
              <button
                type="button"
                onClick={confirm}
                disabled={confirming}
                className="w-full rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
              >
                {confirming ? "Saving…" : "Confirm and pick interests →"}
              </button>
              {confirmedName && confirmedName !== selected && (
                <p className="text-xs text-amber-700">
                  Changing your destination clears any discovery results and itinerary for the old one.
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
