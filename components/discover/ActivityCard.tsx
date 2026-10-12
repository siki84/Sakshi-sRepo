"use client";

import type { Activity } from "@/lib/schemas";
import { chipLabel, GROUPS, type CustomChip, type Group } from "@/lib/interests";
import { groupOf } from "@/lib/rank";
import { SourceLinks } from "../SourceLinks";

export const GROUP_HEX: Record<Group | "other", string> = {
  outdoors: "#10b981",
  city: "#0ea5e9",
  food: "#f59e0b",
  nightlife: "#8b5cf6",
  wellness: "#fb7185",
  other: "#64748b",
};

const BEST: Record<Activity["bestTime"], string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", any: "Any time" };

function hours(h: number) {
  return h < 1 ? `${Math.round(h * 60)} min` : `${h % 1 ? h.toFixed(1) : h} h`;
}

export function ActivityCard({
  a,
  rank,
  custom,
  kept,
  selected,
  removed,
  moreRunning,
  onSelect,
  onKeep,
  onRemove,
  onRestore,
  onMore,
}: {
  a: Activity;
  rank?: number;
  custom: CustomChip[];
  kept: boolean;
  selected: boolean;
  removed?: boolean;
  moreRunning: boolean;
  onSelect: () => void;
  onKeep: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onMore: () => void;
}) {
  const g = groupOf(a.category, custom);
  return (
    <article
      aria-label={a.name}
      onClick={onSelect}
      className={`cursor-pointer space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 transition ${
        selected ? "ring-2 ring-slate-900" : kept ? "ring-rose-300" : "ring-slate-200"
      } ${removed ? "opacity-60" : ""}`}
    >
      <header className="flex items-start gap-3">
        {rank !== undefined && (
          <span
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ background: GROUP_HEX[g ?? "other"] }}
          >
            {rank}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-medium leading-snug">{a.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
            <span className={`rounded px-1.5 py-0.5 ${a.tag === "must_see" ? "bg-amber-100 text-amber-900" : "bg-violet-100 text-violet-900"}`}>
              {a.tag === "must_see" ? "⭐ Must-see" : "💎 Local gem"}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
              {g ? `${GROUPS[g].emoji} ` : ""}
              {chipLabel(a.category, custom)}
            </span>
            {a.similarTo && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-900">✨ More like this</span>}
          </div>
        </div>
      </header>
      <p className="text-sm text-slate-700">{a.why}</p>
      <p className="text-xs text-slate-500">
        📍 {a.area}
        {a.city && !a.area.includes(a.city.split(",")[0]) ? `, ${a.city.split(",")[0]}` : ""} · ⏱ {hours(a.durationHrs)} · 🕒 {BEST[a.bestTime]} ·{" "}
        {a.setting === "outdoor" ? "Outdoors" : a.setting === "indoor" ? "Indoors" : "Indoor/outdoor"}
        {!a.kidFriendly && " · Not ideal for kids"}
        {!a.locationVerified && (
          <span className="ml-1 text-amber-700" title="We couldn't confirm this location with the map service">
            · Location approximate
          </span>
        )}
      </p>
      <SourceLinks sources={a.sources} />
      <div className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
        {removed ? (
          <button type="button" onClick={onRestore} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200">
            ↩ Restore
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onKeep}
              aria-pressed={kept}
              aria-label={kept ? `Unkeep ${a.name}` : `Keep ${a.name}`}
              className={`rounded-lg px-3 py-1.5 text-sm ${kept ? "bg-rose-500 text-white" : "bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
            >
              {kept ? "❤️ Kept" : "♡ Keep"}
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${a.name}`}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
            >
              ✕ Remove
            </button>
            <button
              type="button"
              onClick={onMore}
              disabled={moreRunning}
              aria-label={`More like ${a.name}`}
              className="rounded-lg bg-sky-50 px-3 py-1.5 text-sm text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            >
              {moreRunning ? "Finding…" : "✨ More like this"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
