"use client";

import type { TravelDocs, VisaHeld } from "@/lib/schemas";
import { COUNTRIES, countryName } from "@/lib/countries";

const VISA_KINDS: VisaHeld["kind"][] = ["tourist", "business", "student", "work", "transit", "other"];

export const RESTRICTION_EXAMPLES = [
  "Previous visa refusal or overstay",
  "Criminal record",
  "Passport expires within 6 months",
  "Traveling with a child without both parents",
  "Passport stamps from Israel / other sensitive countries",
  "Need wheelchair-accessible travel",
  "Avoiding countries with current travel advisories",
];

/** Residence permits, visas held, free-text restrictions, and the "no advance visa" preference. */
export function TravelDocsEditor({
  value,
  onChange,
  passports = [],
}: {
  value: TravelDocs;
  onChange: (v: TravelDocs) => void;
  /** Your own passport countries can't issue you a visa or residence permit, so they're hidden. */
  passports?: string[];
}) {
  const foreign = COUNTRIES.filter((x) => !passports.includes(x.code));
  const defaultVisaCountry = ["US", "GB", "DE", "CA", "AU"].find((c) => !passports.includes(c)) ?? foreign[0].code;
  const set = (patch: Partial<TravelDocs>) => onChange({ ...value, ...patch });
  const setVisa = (i: number, patch: Partial<VisaHeld>) =>
    set({ visasHeld: value.visasHeld.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-sm font-medium text-slate-800">Residence permits</div>
        <div className="text-xs text-slate-500">e.g. a US green card, UK BRP, or Schengen residence card. These often unlock visa-free entry elsewhere.</div>
        <div className="flex flex-wrap gap-1.5">
          {value.residencePermits.map((c) => (
            <span key={c} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">
              {countryName(c)}
              <button
                type="button"
                aria-label={`Remove ${countryName(c)} residence permit`}
                className="text-slate-400 hover:text-red-600"
                onClick={() => set({ residencePermits: value.residencePermits.filter((x) => x !== c) })}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <select
          aria-label="Add residence permit"
          value=""
          onChange={(e) =>
            e.target.value && set({ residencePermits: [...new Set([...value.residencePermits, e.target.value])] })
          }
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 sm:w-72"
        >
          <option value="">+ Add a residence permit…</option>
          {foreign.filter((x) => !value.residencePermits.includes(x.code)).map((x) => (
            <option key={x.code} value={x.code}>
              {x.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium text-slate-800">Valid visas you hold</div>
        <div className="text-xs text-slate-500">e.g. a valid US or Schengen visa can let you into other countries without a separate visa.</div>
        {value.visasHeld.map((v, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2" data-testid="visa-held-row">
            <select
              aria-label={`Visa ${i + 1} issuing country`}
              value={v.country}
              onChange={(e) => setVisa(i, { country: e.target.value })}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              {foreign.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              aria-label={`Visa ${i + 1} type`}
              value={v.kind}
              onChange={(e) => setVisa(i, { kind: e.target.value as VisaHeld["kind"] })}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              {VISA_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              expires
              <input
                type="date"
                aria-label={`Visa ${i + 1} expiry`}
                value={v.expires ?? ""}
                onChange={(e) => setVisa(i, { expires: e.target.value || null })}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              aria-label={`Remove visa ${i + 1}`}
              onClick={() => set({ visasHeld: value.visasHeld.filter((_, j) => j !== i) })}
              className="text-sm text-slate-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        ))}
        {value.visasHeld.length < 10 && (
          <button
            type="button"
            onClick={() => set({ visasHeld: [...value.visasHeld, { country: defaultVisaCountry, kind: "tourist", expires: null }] })}
            className="text-sm text-slate-700 underline"
          >
            + Add a visa you hold
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="travel-restrictions" className="text-sm font-medium text-slate-800">
          Anything else that could affect entry or where you can go?
        </label>
        <div className="text-xs text-slate-500">Optional. Saved in your local database and sent to Claude only to check entry rules. For example:</div>
        <div className="flex flex-wrap gap-1.5">
          {RESTRICTION_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() =>
                set({ restrictions: value.restrictions.trim() ? `${value.restrictions.trim()}; ${ex}` : ex })
              }
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200"
            >
              + {ex}
            </button>
          ))}
        </div>
        <textarea
          id="travel-restrictions"
          value={value.restrictions}
          onChange={(e) => set({ restrictions: e.target.value })}
          rows={2}
          maxLength={800}
          placeholder="Leave blank if nothing applies"
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.avoidAdvanceVisa}
          onChange={(e) => set({ avoidAdvanceVisa: e.target.checked })}
          className="mt-1"
        />
        <span>
          Only suggest places I can enter <strong>without applying for a visa in advance</strong>
          <span className="block text-xs text-slate-500">Visa-free, a quick online travel authorization (ETA), or visa on arrival.</span>
        </span>
      </label>
    </div>
  );
}

export function summarizeTravelDocs(d: TravelDocs): string {
  const parts = [
    ...d.residencePermits.map((c) => `${countryName(c)} residence permit`),
    ...d.visasHeld.map((v) => `${countryName(v.country)} ${v.kind} visa`),
  ];
  if (d.restrictions.trim()) parts.push(`“${d.restrictions.trim().slice(0, 60)}${d.restrictions.trim().length > 60 ? "…" : ""}”`);
  if (d.avoidAdvanceVisa) parts.push("no advance visas");
  return parts.length ? parts.join(" · ") : "Passport only, no restrictions";
}
