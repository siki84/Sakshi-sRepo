import type { FitCard, FitLabel, VisaStatus } from "@/lib/schemas";
import { countryName } from "@/lib/countries";
import { formatTemp } from "@/lib/units";
import { LABEL_TEXT } from "@/lib/weather/score";
import { SourceLinks } from "../SourceLinks";

const LABEL_STYLE: Record<FitLabel, string> = {
  great: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  good: "bg-lime-100 text-lime-900 ring-lime-300",
  mixed: "bg-amber-100 text-amber-900 ring-amber-300",
  poor: "bg-rose-100 text-rose-900 ring-rose-300",
};

const VISA_TEXT: Record<VisaStatus, string> = {
  visa_free: "Visa-free",
  eta: "Travel authorization (ETA) needed",
  evisa: "eVisa needed",
  visa_on_arrival: "Visa on arrival",
  visa_required: "Visa required in advance",
  not_allowed: "Entry not currently allowed",
  unknown: "Unclear — check official sources",
};
const VISA_TONE: Record<VisaStatus, string> = {
  visa_free: "text-emerald-700",
  eta: "text-lime-700",
  visa_on_arrival: "text-lime-700",
  evisa: "text-amber-700",
  visa_required: "text-rose-700",
  not_allowed: "text-rose-700",
  unknown: "text-amber-700",
};
const DOC_EFFECT = {
  grants_entry: "Gets you in",
  eases_entry: "Makes entry easier",
  no_effect: "Doesn't help here",
  unknown: "Unclear — check with the embassy",
} as const;
const IMPACT = {
  blocker: { text: "Blocker", cls: "bg-rose-100 text-rose-900" },
  caution: { text: "Caution", cls: "bg-amber-100 text-amber-900" },
  ok: { text: "OK", cls: "bg-emerald-100 text-emerald-900" },
  unknown: { text: "Unclear", cls: "bg-slate-100 text-slate-700" },
} as const;
const LEVEL = { low: "Low", moderate: "Moderate", high: "High", very_high: "Very high" } as const;
const SEASON = { peak: "Peak season", shoulder: "Shoulder season", off: "Off-season" } as const;

export function Badge({ label, score }: { label: FitLabel; score?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${LABEL_STYLE[label]}`}>
      {LABEL_TEXT[label]}
      {score !== undefined && <span className="opacity-70">· {score}</span>}
    </span>
  );
}

function officialSearchUrl(card: FitCard, passport: string) {
  const q = `${card.place.countryCode ? countryName(card.place.countryCode) : card.place.name} entry requirements for ${countryName(passport)} citizens official government`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function FitCardView({
  card,
  units,
  highlight,
  action,
}: {
  card: FitCard;
  units: "F" | "C";
  highlight?: boolean;
  action?: React.ReactNode;
}) {
  const c = card.climate;
  return (
    <article
      className={`flex flex-col gap-4 rounded-xl bg-white p-5 shadow-sm ring-1 ${highlight ? "ring-2 ring-emerald-500" : "ring-slate-200"}`}
      aria-label={`Fit card for ${card.place.name}`}
    >
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">{card.place.name}</h3>
          <Badge label={card.overall.label} />
        </div>
        <p className="text-sm text-slate-600">{card.vibe}</p>
      </header>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">☀️ Weather fit</h4>
          {card.weatherFit && <Badge label={card.weatherFit.label} score={card.weatherFit.score} />}
        </div>
        {c ? (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">High / low</dt>
                <dd>
                  {formatTemp(c.avgHighF, units)} / {formatTemp(c.avgLowF, units)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Rainy days</dt>
                <dd>~{Math.round(c.rainyDaysPerMonth)}/mo</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Humidity</dt>
                <dd>{c.humidityPct !== null ? `${c.humidityPct}%` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Daylight</dt>
                <dd>{c.daylightHours !== null ? `${c.daylightHours} h` : "—"}</dd>
              </div>
            </dl>
            <ul className="space-y-0.5 text-sm">
              {card.weatherFit?.reasons.map((r) => (
                <li key={r.text} className={r.tone === "bad" ? "text-rose-700" : r.tone === "good" ? "text-emerald-700" : "text-slate-600"}>
                  {r.tone === "bad" ? "✗" : r.tone === "good" ? "✓" : "•"} {r.text}
                </li>
              ))}
            </ul>
            <p className="text-sm text-slate-700">{card.weatherVerdict}</p>
            <p className="text-xs text-slate-500">
              Source:{" "}
              <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline">
                Open-Meteo
              </a>{" "}
              ({c.basis})
            </p>
          </>
        ) : (
          <p className="text-sm text-amber-700">Weather data unavailable. {card.weatherVerdict}</p>
        )}
      </section>

      <section className="space-y-1.5">
        <h4 className="text-sm font-medium">📅 Season</h4>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded bg-slate-100 px-2 py-0.5">{SEASON[card.season.level]}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5">Crowds: {LEVEL[card.season.crowds]}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5">Prices: {LEVEL[card.season.prices]}</span>
        </div>
        <p className="text-sm text-slate-700">{card.season.summary}</p>
        <SourceLinks sources={card.season.sources} />
        {card.events.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {card.events.map((e) => (
              <li key={e.name} className="text-sm">
                <span className="mr-1">{e.impact === "positive" ? "🎉" : e.impact === "negative" ? "⚠️" : "•"}</span>
                <span className="font-medium">{e.name}</span> <span className="text-slate-500">({e.when})</span> — {e.detail}{" "}
                <SourceLinks sources={e.sources} label="src" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1.5">
        <h4 className="text-sm font-medium">🛂 Visa &amp; entry</h4>
        {card.visa ? (
          <>
            <p className={`text-sm font-medium ${VISA_TONE[card.visa.best.status]}`}>
              {VISA_TEXT[card.visa.best.status]}
              {card.visa.best.via ? (
                <span className="font-normal text-slate-500"> (with your {card.visa.best.via})</span>
              ) : (
                card.visa.perPassport.length > 1 && (
                  <span className="font-normal text-slate-500"> (on your {countryName(card.visa.best.passport)} passport)</span>
                )
              )}
            </p>
            <ul className="space-y-1 text-sm text-slate-700">
              {card.visa.perPassport.map((p) => (
                <li key={p.passport}>
                  {card.visa!.perPassport.length > 1 && <span className="font-medium">{countryName(p.passport)}: </span>}
                  {card.visa!.perPassport.length > 1 && `${VISA_TEXT[p.status]}. `}
                  {p.maxStay && `Stay up to ${p.maxStay}. `}
                  {p.leadTime && `Lead time: ${p.leadTime}. `}
                  {p.notes}
                </li>
              ))}
            </ul>
            {card.visa.otherDocuments.length > 0 && (
              <ul className="space-y-1 text-sm text-slate-700" aria-label="Your other documents">
                {card.visa.otherDocuments.map((o) => (
                  <li key={o.document}>
                    <span className="font-medium">{o.document}: </span>
                    {DOC_EFFECT[o.effect]}. {o.notes} <SourceLinks sources={o.sources} label="src" />
                  </li>
                ))}
              </ul>
            )}
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
              Confidence: {card.visa.confidence}. Entry rules change — always verify with the{" "}
              {card.visa.officialUrl ? (
                <a href={card.visa.officialUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  official source
                </a>
              ) : (
                <a href={officialSearchUrl(card, card.visa.best.passport)} target="_blank" rel="noopener noreferrer" className="underline">
                  official government source
                </a>
              )}{" "}
              before booking.
            </p>
            <SourceLinks sources={card.visa.sources} />
          </>
        ) : (
          <p className="text-sm text-slate-600">Domestic trip — no visa needed.</p>
        )}
      </section>

      {card.restrictions.length > 0 && (
        <section className="space-y-1.5" aria-label="Your restrictions">
          <h4 className="text-sm font-medium">⚠️ Your restrictions</h4>
          <ul className="space-y-1.5 text-sm">
            {card.restrictions.map((r) => (
              <li key={r.concern}>
                <span className={`mr-1 rounded px-1.5 py-0.5 text-xs font-medium ${IMPACT[r.impact].cls}`}>{IMPACT[r.impact].text}</span>
                <span className="font-medium">{r.concern}</span> — {r.notes} <SourceLinks sources={r.sources} label="src" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1 border-t border-slate-100 pt-3">
        <h4 className="text-sm font-medium">Bottom line</h4>
        <p className="text-sm text-slate-700">{card.overall.summary}</p>
      </section>

      {action && <div className="mt-auto">{action}</div>}
    </article>
  );
}
