"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Profile, Tolerance } from "@/lib/schemas";
import { COUNTRIES, countryName } from "@/lib/countries";
import { cToF, fToC } from "@/lib/units";
import { saveProfileAction } from "@/app/profile/actions";

export const DEFAULT_PROFILE: Profile = {
  homeCity: "",
  passports: [],
  weather: {
    idealMinF: 65,
    idealMaxF: 80,
    heat: "dislike",
    cold: "ok",
    humidity: "dislike",
    rain: "dislike",
    notes: "",
  },
  travelers: { type: "partner", kidsAges: [], groupSize: 2 },
  pace: 3,
  units: "F",
};

const TOLERANCE_LABELS: Record<Tolerance, string> = {
  love: "Love it",
  ok: "Fine",
  dislike: "Dislike",
  hate: "Avoid",
};

const WEATHER_ASPECTS = [
  { key: "heat", label: "Hotter than my range" },
  { key: "cold", label: "Colder than my range" },
  { key: "humidity", label: "Humidity" },
  { key: "rain", label: "Rainy days" },
] as const;

const PACE_LABELS = ["", "Very relaxed", "Relaxed", "Balanced", "Busy", "Packed"];

const TRAVELER_TYPES = [
  { key: "solo", label: "Solo" },
  { key: "partner", label: "Partner" },
  { key: "family", label: "Family with kids" },
  { key: "friends", label: "Group of friends" },
] as const;

function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-slate-800">{label}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
      {children}
      {error && <div className="text-sm text-red-600" role="alert">{error}</div>}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full px-3 py-1.5 text-sm ring-1 ${
            value === o.key ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProfileForm({ initial, next }: { initial: Profile | null; next?: string }) {
  const [p, setP] = useState<Profile>(initial ?? DEFAULT_PROFILE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const set = (patch: Partial<Profile>) => {
    setP((cur) => ({ ...cur, ...patch }));
    setSaved(false);
  };
  const setWeather = (patch: Partial<Profile["weather"]>) => set({ weather: { ...p.weather, ...patch } });
  const setTravelers = (patch: Partial<Profile["travelers"]>) => set({ travelers: { ...p.travelers, ...patch } });

  const c = p.units === "C";
  const toDisplay = (f: number) => (c ? fToC(f) : f);
  const fromDisplay = (v: number) => (c ? cToF(v) : v);
  const [minDisplay, maxDisplay] = c ? [-7, 43] : [20, 110];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProfileAction(p);
      if (res.ok) {
        setErrors({});
        setSaved(true);
        if (next) router.push(next);
        else router.refresh();
      } else {
        setErrors(res.errors);
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <section className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-medium">About you</h2>
        <Field label="Home city" hint="Used for travel distance and flight-time context." error={errors.homeCity}>
          <input
            value={p.homeCity}
            onChange={(e) => set({ homeCity: e.target.value })}
            placeholder="e.g. Chicago, IL"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            aria-label="Home city"
          />
        </Field>

        <Field label="Passport(s)" hint="Used for visa and entry checks. Add every passport you could travel on." error={errors.passports}>
          <div className="flex flex-wrap gap-1.5">
            {p.passports.map((code) => (
              <span key={code} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">
                {countryName(code)}
                <button
                  type="button"
                  aria-label={`Remove ${countryName(code)}`}
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => set({ passports: p.passports.filter((x) => x !== code) })}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <select
            aria-label="Add passport"
            value=""
            onChange={(e) => e.target.value && set({ passports: [...new Set([...p.passports, e.target.value])] })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 sm:w-72"
          >
            <option value="">+ Add a passport…</option>
            {COUNTRIES.filter((x) => !p.passports.includes(x.code)).map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Weather you enjoy</h2>
          <Segmented
            name="Temperature units"
            value={p.units}
            options={[
              { key: "F", label: "°F" },
              { key: "C", label: "°C" },
            ]}
            onChange={(units) => set({ units })}
          />
        </div>

        <Field
          label={`Ideal daytime temperature: ${toDisplay(p.weather.idealMinF)}–${toDisplay(p.weather.idealMaxF)}°${p.units}`}
          error={errors["weather.idealMaxF"]}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <span className="w-10">Low</span>
              <input
                type="range"
                min={minDisplay}
                max={maxDisplay}
                value={toDisplay(p.weather.idealMinF)}
                aria-label="Ideal temperature low"
                onChange={(e) => setWeather({ idealMinF: Math.min(fromDisplay(+e.target.value), p.weather.idealMaxF - 1) })}
                className="flex-1"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <span className="w-10">High</span>
              <input
                type="range"
                min={minDisplay}
                max={maxDisplay}
                value={toDisplay(p.weather.idealMaxF)}
                aria-label="Ideal temperature high"
                onChange={(e) => setWeather({ idealMaxF: Math.max(fromDisplay(+e.target.value), p.weather.idealMinF + 1) })}
                className="flex-1"
              />
            </label>
          </div>
        </Field>

        <div className="space-y-3">
          {WEATHER_ASPECTS.map((a) => (
            <div key={a.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-700">{a.label}</div>
              <Segmented
                name={a.label}
                value={p.weather[a.key]}
                options={(Object.keys(TOLERANCE_LABELS) as Tolerance[]).map((k) => ({ key: k, label: TOLERANCE_LABELS[k] }))}
                onChange={(v) => setWeather({ [a.key]: v })}
              />
            </div>
          ))}
        </div>

        <Field label="Anything else about weather?" hint='e.g. "OK with cold if it’s dry", "need sun for photos", "no snow".'>
          <textarea
            value={p.weather.notes}
            onChange={(e) => setWeather({ notes: e.target.value })}
            rows={2}
            maxLength={500}
            aria-label="Weather notes"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </Field>
      </section>

      <section className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-medium">How you travel</h2>
        <Field label="Who usually comes along">
          <Segmented
            name="Who usually travels"
            value={p.travelers.type}
            options={TRAVELER_TYPES.map((t) => ({ key: t.key, label: t.label }))}
            onChange={(type) =>
              setTravelers({
                type,
                groupSize: type === "solo" ? 1 : type === "partner" ? 2 : Math.max(p.travelers.groupSize, 3),
                kidsAges: type === "family" ? p.travelers.kidsAges : [],
              })
            }
          />
        </Field>

        {p.travelers.type === "family" && (
          <Field label="Kids' ages" hint="Comma-separated, e.g. 4, 9" error={errors["travelers.kidsAges"]}>
            <KidsAgesInput value={p.travelers.kidsAges} onChange={(kidsAges) => setTravelers({ kidsAges })} />
          </Field>
        )}

        {(p.travelers.type === "family" || p.travelers.type === "friends") && (
          <Field label="Group size (including you)" error={errors["travelers.groupSize"]}>
            <input
              type="number"
              min={2}
              max={30}
              value={p.travelers.groupSize}
              aria-label="Group size"
              onChange={(e) => setTravelers({ groupSize: Math.max(1, Math.round(+e.target.value || 1)) })}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2"
            />
          </Field>
        )}

        <Field label={`Pace: ${PACE_LABELS[p.pace]}`} hint="How full you like your days. Drives activities per day and trip length.">
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span>Relaxed</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={p.pace}
              aria-label="Pace"
              onChange={(e) => set({ pace: +e.target.value })}
              className="flex-1"
            />
            <span>Packed</span>
          </div>
        </Field>
      </section>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button disabled={pending} className="rounded-lg bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-50">
          {pending ? "Saving…" : next ? "Save and continue" : "Save profile"}
        </button>
        {saved && <span className="text-sm text-green-700" role="status">Saved ✓</span>}
        {Object.keys(errors).length > 0 && <span className="text-sm text-red-600">Please fix the highlighted fields.</span>}
      </div>
    </form>
  );
}

function KidsAgesInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <input
      value={text}
      aria-label="Kids' ages"
      placeholder="e.g. 4, 9"
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number)
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 17),
        );
      }}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 sm:w-48"
    />
  );
}
