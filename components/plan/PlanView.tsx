"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Activity, BlockKey, InterestsState, Itinerary, PlanDay, Stay } from "@/lib/schemas";
import { GROUPS, activeGroups } from "@/lib/interests";
import { groupOf } from "@/lib/rank";
import { formatTemp } from "@/lib/units";
import { GROUP_HEX } from "../discover/ActivityCard";
import { SourceLinks } from "../SourceLinks";

const MapView = dynamic(() => import("../discover/MapView"), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-xl bg-slate-100" />,
});

const BLOCKS: { key: BlockKey; label: string; icon: string }[] = [
  { key: "morning", label: "Morning", icon: "🌅" },
  { key: "afternoon", label: "Afternoon", icon: "☀️" },
  { key: "evening", label: "Evening", icon: "🌙" },
];
const KIND_BADGE: Record<PlanDay["kind"], string | null> = {
  arrival: "Arrival day",
  departure: "Departure day",
  travel: "Travel day",
  daytrip: "Day trip",
  full: null,
  free: "Free day",
};

export type MoveTarget = { toDay: number | null; block: BlockKey | null };

function dayIds(d: PlanDay) {
  return [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening];
}

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function MixCompare({ achieved, target, interests }: { achieved: Record<string, number>; target: Record<string, number>; interests: InterestsState }) {
  const groups = activeGroups(interests.chips, interests.custom);
  return (
    <div className="space-y-1.5" aria-label="Mix achieved vs asked">
      {groups.map((g) => (
        <div key={g} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2 text-xs">
          <span>
            {GROUPS[g].emoji} {GROUPS[g].label}
          </span>
          <div className="relative h-2.5 rounded-full bg-slate-100">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${achieved[g] ?? 0}%`, background: GROUP_HEX[g] }} />
            <div className="absolute inset-y-[-3px] w-0.5 bg-slate-900" style={{ left: `${target[g] ?? 0}%` }} title={`You asked for ${target[g]}%`} />
          </div>
          <span className="text-right font-mono">
            {achieved[g] ?? 0}% <span className="text-slate-400">/ {target[g] ?? 0}%</span>
          </span>
        </div>
      ))}
      <p className="text-xs text-slate-500">Bar = time in this plan · line = what you asked for.</p>
    </div>
  );
}

function ActivityChip({
  a,
  editable,
  days,
  onMove,
  index,
}: {
  a: Activity;
  editable: boolean;
  days: PlanDay[];
  onMove?: (id: string, t: MoveTarget) => void;
  index?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: a.id, disabled: !editable });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  const g = groupOf(a.category, []);
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-2 rounded-lg bg-white p-2 text-sm ring-1 ring-slate-200 ${isDragging ? "opacity-70 shadow-lg" : ""}`}
      aria-label={a.name}
    >
      {editable && (
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none text-slate-400 hover:text-slate-700"
          aria-label={`Drag ${a.name}`}
          {...listeners}
          {...attributes}
        >
          ⠿
        </button>
      )}
      {index !== undefined && (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: GROUP_HEX[g ?? "other"] }}>
          {index}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug">
          {a.tag === "must_see" ? "⭐ " : "💎 "}
          {a.name}
        </div>
        <div className="text-xs text-slate-500">
          {a.area} · {a.durationHrs < 1 ? `${Math.round(a.durationHrs * 60)} min` : `${a.durationHrs} h`}
          {!a.locationVerified && " · location approximate"}
        </div>
      </div>
      {editable && onMove && (
        <select
          aria-label={`Move ${a.name}`}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            onMove(a.id, v === "optional" ? { toDay: null, block: null } : { toDay: Number(v), block: null });
          }}
          className="max-w-24 rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-600"
        >
          <option value="">Move…</option>
          {days.map((d) => (
            <option key={d.n} value={d.n}>
              Day {d.n}
            </option>
          ))}
          <option value="optional">Optional</option>
        </select>
      )}
    </li>
  );
}

function DropZone({ id, children, label }: { id: string; children: React.ReactNode; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} aria-label={label} className={`rounded-lg p-1 transition ${isOver ? "bg-emerald-50 ring-2 ring-emerald-400" : ""}`}>
      {children}
    </div>
  );
}

export function PlanView({
  itinerary,
  activities,
  stays,
  interests,
  center,
  units,
  editable = false,
  onMove,
}: {
  itinerary: Itinerary;
  activities: Record<string, Activity>;
  stays: Stay[];
  interests: InterestsState;
  center: { lat: number; lng: number };
  units: "F" | "C";
  editable?: boolean;
  onMove?: (id: string, t: MoveTarget) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<number>(itinerary.days[0]?.n ?? 1);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const day = itinerary.days.find((d) => d.n === selectedDay) ?? itinerary.days[0];
  const routeItems = day ? dayIds(day).map((id) => activities[id]).filter(Boolean) : [];
  const points = routeItems.map((a, i) => ({
    id: a.id,
    lat: a.lat,
    lng: a.lng,
    label: String(i + 1),
    title: a.name,
    color: GROUP_HEX[groupOf(a.category, interests.custom) ?? "other"],
    approximate: !a.locationVerified,
  }));
  const stayPoints = stays.map((s, i) => ({ id: `stay-${i}`, lat: s.lat, lng: s.lng, label: "🛏", title: `Stay: ${s.name}`, color: "#0f172a" }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || !onMove) return;
    const target = String(e.over.id);
    if (target === "optional") onMove(String(e.active.id), { toDay: null, block: null });
    else {
      const [, n, block] = target.split(":");
      onMove(String(e.active.id), { toDay: Number(n), block: block as BlockKey });
    }
  };

  const unmet = itinerary.checks.filter((c) => c.status === "not_met");

  const body = (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h3 className="text-sm font-medium">Your mix: planned vs asked</h3>
          <MixCompare achieved={itinerary.achievedMix} target={interests.mix} interests={interests} />
        </div>
        <div className="space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Requirement checks">
          <h3 className="text-sm font-medium">Your requirements</h3>
          {itinerary.checks.length === 0 ? (
            <p className="text-xs text-slate-500">You didn&apos;t set any hard requirements.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {itinerary.checks.map((c) => (
                <li key={c.text}>
                  <span className={c.status === "met" ? "text-emerald-700" : c.status === "not_met" ? "text-rose-700" : "text-slate-500"}>
                    {c.status === "met" ? "✓" : c.status === "not_met" ? "✗" : "•"}
                  </span>{" "}
                  <span className="font-medium">{c.text}</span> <span className="text-xs text-slate-500">— {c.detail}</span>
                </li>
              ))}
            </ul>
          )}
          {unmet.length > 0 && editable && <p className="text-xs text-rose-700">Ask in chat or drag things around to fix the ✗ items.</p>}
        </div>
      </section>

      {stays.length > 0 && (
        <section className="space-y-2" aria-label="Where to stay">
          <h3 className="font-medium">🛏 Where to stay</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {stays.map((s, i) => (
              <article key={`${s.name}-${i}`} className="space-y-1.5 rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-medium">{s.name}</h4>
                  <span className="text-xs text-slate-500">{s.priceFeel} · ~{s.avgKmToDays} km to your days</span>
                </div>
                <p className="text-slate-700">{s.why}</p>
                <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
                  <dt className="text-slate-500">Walkability</dt>
                  <dd>{s.walkability}</dd>
                  <dt className="text-slate-500">Transit</dt>
                  <dd>{s.transit}</dd>
                  <dt className="text-slate-500">Noise</dt>
                  <dd>{s.noise}</dd>
                  <dt className="text-slate-500">Best for</dt>
                  <dd>{s.bestFor}</dd>
                </dl>
                <SourceLinks sources={s.sources} />
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="gap-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="space-y-3">
          {itinerary.days.map((d) => {
            const ids = dayIds(d);
            let idx = 0;
            return (
              <article
                key={d.n}
                aria-label={`Day ${d.n}`}
                onClick={() => setSelectedDay(d.n)}
                className={`space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ${selectedDay === d.n ? "ring-2 ring-slate-900" : "ring-slate-200"} print:break-inside-avoid`}
              >
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-slate-500">
                      Day {d.n}
                      {d.date ? ` · ${fmtDate(d.date)}` : ""} · {d.area}
                      {d.city && !d.area.includes(d.city.split(",")[0]) ? `, ${d.city.split(",")[0]}` : ""}
                    </div>
                    <h3 className="font-medium">{d.title || `Day ${d.n}`}</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {KIND_BADGE[d.kind] && <span className="rounded bg-slate-100 px-1.5 py-0.5">{KIND_BADGE[d.kind]}</span>}
                    {d.forecast && (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-900">
                        {d.forecast.precipProb !== null && d.forecast.precipProb >= 60 ? "🌧️" : "☀️"} {formatTemp(d.forecast.highF, units)}
                        {d.forecast.precipProb !== null ? ` · ${d.forecast.precipProb}%` : ""}
                      </span>
                    )}
                    {ids.length > 1 && <span className="rounded bg-slate-100 px-1.5 py-0.5">{d.routeKm} km</span>}
                    {d.sprawl && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900" title="Stops are far apart for one day">
                        ⚠ Spread out
                      </span>
                    )}
                  </div>
                </header>
                {d.summary && <p className="text-sm text-slate-600">{d.summary}</p>}
                {d.weatherNote && <p className="text-xs text-sky-800">🌦 {d.weatherNote}</p>}
                <div className="space-y-2">
                  {BLOCKS.map((b) => (
                    <DropZone key={b.key} id={`day:${d.n}:${b.key}`} label={`Day ${d.n} ${b.label}`}>
                      <div className="mb-1 text-xs font-medium text-slate-500">
                        {b.icon} {b.label}
                      </div>
                      {d.blocks[b.key].length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-200 p-2 text-xs text-slate-400">
                          {editable ? "Free — drop something here" : "Free time"}
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {d.blocks[b.key].map((id) => {
                            const a = activities[id];
                            if (!a) return null;
                            idx++;
                            return <ActivityChip key={id} a={a} editable={editable} days={itinerary.days} onMove={onMove} index={idx} />;
                          })}
                        </ul>
                      )}
                    </DropZone>
                  ))}
                </div>
              </article>
            );
          })}

          {editable && itinerary.optional.length > 0 && (
            <DropZone id="optional" label="Optional">
              <section className="space-y-2 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <h3 className="text-sm font-medium">If there&apos;s time ({itinerary.optional.length})</h3>
                <p className="text-xs text-slate-500">Good ideas that didn&apos;t fit. Drag one onto a day, or use Move…</p>
                <ul className="space-y-1.5">
                  {itinerary.optional.map((id) =>
                    activities[id] ? <ActivityChip key={id} a={activities[id]} editable days={itinerary.days} onMove={onMove} /> : null,
                  )}
                </ul>
              </section>
            </DropZone>
          )}
        </div>

        <div className="no-print mt-4 md:mt-0">
          <div className="space-y-2 md:sticky md:top-4">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Day map">
              {itinerary.days.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  role="tab"
                  aria-selected={selectedDay === d.n}
                  onClick={() => setSelectedDay(d.n)}
                  className={`rounded-full px-2.5 py-1 text-xs ring-1 ${selectedDay === d.n ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300"}`}
                >
                  Day {d.n}
                </button>
              ))}
            </div>
            <MapView
              points={[...points, ...stayPoints]}
              center={routeItems[0] ?? center}
              route={routeItems}
              className="h-72 md:h-[calc(100vh-12rem)]"
            />
            <p className="text-xs text-slate-500">
              Day {day?.n} route: {points.length} stop{points.length === 1 ? "" : "s"}
              {day && points.length > 1 ? `, ~${day.routeKm} km end to end` : ""}. 🛏 = suggested base.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return editable ? (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {body}
    </DndContext>
  ) : (
    body
  );
}

