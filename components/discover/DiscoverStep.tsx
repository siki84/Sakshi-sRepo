"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Progress } from "@/lib/ai/client";
import type { Activity, DiscoverState, InterestsState } from "@/lib/schemas";
import { GROUPS, activeGroups, type Group } from "@/lib/interests";
import { groupOf, hoursMix, rankActivities } from "@/lib/rank";
import { postSse } from "@/lib/sseClient";
import { confirmDiscoveryAction, setActivityStatusAction } from "@/app/trip/[id]/actions";
import { ProgressLog } from "../ProgressLog";
import { ActivityCard, GROUP_HEX } from "./ActivityCard";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="h-80 animate-pulse rounded-xl bg-slate-100" />,
});

type TagFilter = "all" | "must_see" | "local_gem";

export function DiscoverStep({
  tripId,
  initial,
  interests,
  center,
  placeName,
  stale,
}: {
  tripId: string;
  initial: DiscoverState | null;
  interests: InterestsState;
  center: { lat: number; lng: number };
  placeName: string;
  stale: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<DiscoverState | null>(initial);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tag, setTag] = useState<TagFilter>("all");
  const [group, setGroup] = useState<Group | "all">("all");
  const [view, setView] = useState<"list" | "map">("list");
  const [selected, setSelected] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [continuing, startContinue] = useTransition();

  const ranked = useMemo(
    () => (state ? rankActivities(state.pool, interests, state.removed) : []),
    [state, interests],
  );
  const rankOf = useMemo(() => new Map(ranked.map((a, i) => [a.id, i + 1])), [ranked]);
  const visible = ranked.filter(
    (a) => (tag === "all" || a.tag === tag) && (group === "all" || groupOf(a.category, interests.custom) === group),
  );
  const kept = new Set(state?.kept ?? []);
  const keptItems = ranked.filter((a) => kept.has(a.id));
  const removedItems = state ? state.pool.filter((a) => state.removed.includes(a.id)) : [];
  const groups = activeGroups(interests.chips, interests.custom);

  async function research() {
    setRunning(true);
    setError(null);
    setProgress([]);
    try {
      await postSse(`/api/trips/${tripId}/discover`, {}, (event, data) => {
        if (event === "progress") setProgress((p) => [...p, data as Progress]);
        else if (event === "result") {
          setState(data as DiscoverState);
          router.refresh();
        } else if (event === "error") setError((data as { message: string }).message);
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function more(a: Activity) {
    setMoreFor(a.id);
    setError(null);
    try {
      await postSse(`/api/trips/${tripId}/discover/more`, { activityId: a.id }, (event, data) => {
        if (event === "progress") setProgress((p) => [...p, data as Progress]);
        else if (event === "result") {
          const added = (data as { added: Activity[] }).added;
          setState((s) => (s ? { ...s, pool: [...s.pool, ...added.filter((x) => !s.pool.some((y) => y.id === x.id))] } : s));
          if (!added.length) setError(`Couldn't find anything new like ${a.name}.`);
        } else if (event === "error") setError((data as { message: string }).message);
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMoreFor(null);
    }
  }

  function setStatus(id: string, status: "kept" | "removed" | "none") {
    setState((s) => {
      if (!s) return s;
      const k = s.kept.filter((x) => x !== id);
      const r = s.removed.filter((x) => x !== id);
      if (status === "kept") k.push(id);
      if (status === "removed") r.push(id);
      return { ...s, kept: k, removed: r };
    });
    void setActivityStatusAction({ tripId, activityId: id, status });
  }

  function proceed() {
    startContinue(async () => {
      const res = await confirmDiscoveryAction(tripId);
      if (res.ok) router.push(`/trip/${tripId}/length`);
      else setError(res.error);
    });
  }

  if (!state) {
    return (
      <div className="space-y-4">
        <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-medium">What&apos;s actually worth doing in {placeName.split(",")[0]}?</h2>
          <p className="text-sm text-slate-600">
            We&apos;ll dig through Reddit, Pinterest, travel blogs, and local guides for the must-sees you&apos;d regret skipping and the
            local gems that never make the top-10 lists — matched to your interests, each with its source.
          </p>
          <p className="text-xs text-slate-500">Takes a couple of minutes (several searches run in parallel). Results are cached.</p>
          <button
            type="button"
            onClick={research}
            disabled={running}
            className="rounded-lg bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {running ? "Researching…" : "Find things to do"}
          </button>
          {error && (
            <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              {error}
            </p>
          )}
        </section>
        <ProgressLog items={progress} running={running} />
      </div>
    );
  }

  const keptMix = hoursMix(keptItems, interests.custom);
  const points = visible.map((a) => ({
    id: a.id,
    lat: a.lat,
    lng: a.lng,
    label: String(rankOf.get(a.id)),
    title: a.name,
    color: kept.has(a.id) ? "#e11d48" : GROUP_HEX[groupOf(a.category, interests.custom) ?? "other"],
    approximate: !a.locationVerified,
  }));

  return (
    <div className="space-y-4">
      {stale && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Your interests changed since this list was researched.
          <button type="button" onClick={research} disabled={running} className="rounded bg-amber-600 px-3 py-1 text-white disabled:opacity-50">
            {running ? "Refreshing…" : "Research new interests"}
          </button>
        </div>
      )}

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">
            {ranked.length} ideas · <span className="text-rose-600">{kept.size} kept</span>
          </h2>
          <div className="flex gap-1 md:hidden" role="radiogroup" aria-label="View">
            {(["list", "map"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 text-sm ring-1 ${view === v ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300"}`}
              >
                {v === "list" ? "List" : "Map"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">Ranked by your mix. ❤️ Keep what appeals — your days will be built from it.</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type filter">
          {(
            [
              ["all", "All"],
              ["must_see", "⭐ Must-sees"],
              ["local_gem", "💎 Local gems"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={tag === k}
              onClick={() => setTag(k)}
              className={`rounded-full px-3 py-1 text-xs ring-1 ${tag === k ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300"}`}
            >
              {l}
            </button>
          ))}
          <span className="mx-1 w-px bg-slate-200" />
          <select
            aria-label="Interest filter"
            value={group}
            onChange={(e) => setGroup(e.target.value as Group | "all")}
            className="rounded-full bg-white px-2 py-1 text-xs ring-1 ring-slate-300"
          >
            <option value="all">All interests</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {GROUPS[g].emoji} {GROUPS[g].label}
              </option>
            ))}
          </select>
        </div>
        {keptItems.length >= 3 && (
          <p className="text-xs text-slate-600" data-testid="kept-mix">
            Kept so far (by time): {groups.map((g) => `${GROUPS[g].label} ${keptMix[g]}%`).join(" / ")}{" "}
            <span className="text-slate-400">· you asked for {groups.map((g) => `${interests.mix[g]}%`).join(" / ")}</span>
          </p>
        )}
      </section>

      <div className="gap-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className={`space-y-3 ${view === "map" ? "hidden md:block" : ""}`} aria-label="Activity list" role="list">
          {visible.length === 0 && <p className="text-sm text-slate-500">Nothing matches these filters.</p>}
          {visible.map((a) => (
            <div role="listitem" key={a.id}>
              <ActivityCard
                a={a}
                rank={rankOf.get(a.id)}
                custom={interests.custom}
                kept={kept.has(a.id)}
                selected={selected === a.id}
                moreRunning={moreFor === a.id}
                onSelect={() => setSelected(a.id)}
                onKeep={() => setStatus(a.id, kept.has(a.id) ? "none" : "kept")}
                onRemove={() => setStatus(a.id, "removed")}
                onRestore={() => setStatus(a.id, "none")}
                onMore={() => more(a)}
              />
            </div>
          ))}
          {removedItems.length > 0 && (
            <div className="pt-2">
              <button type="button" onClick={() => setShowRemoved(!showRemoved)} className="text-sm text-slate-600 underline">
                {showRemoved ? "Hide" : "Show"} removed ({removedItems.length})
              </button>
              {showRemoved && (
                <div className="mt-2 space-y-2">
                  {removedItems.map((a) => (
                    <ActivityCard
                      key={a.id}
                      a={a}
                      custom={interests.custom}
                      kept={false}
                      removed
                      selected={false}
                      moreRunning={false}
                      onSelect={() => {}}
                      onKeep={() => {}}
                      onRemove={() => {}}
                      onRestore={() => setStatus(a.id, "none")}
                      onMore={() => {}}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className={`${view === "list" ? "hidden md:block" : ""}`}>
          <div className="md:sticky md:top-4">
            <MapView points={points} center={center} selectedId={selected} onSelect={setSelected} className="h-[65vh] md:h-[calc(100vh-9rem)]" />
            <p className="mt-1 text-xs text-slate-500">Dashed pins: location approximate. Red pins: kept.</p>
          </div>
        </div>
      </div>

      <ProgressLog items={progress} running={running || moreFor !== null} />
      {error && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border-0 sm:ring-1 sm:ring-slate-200">
        <span className="text-sm text-slate-600">
          {kept.size === 0 ? "Keep a few favorites — or continue and we'll use the top-ranked picks." : `${kept.size} kept`}
        </span>
        <button
          type="button"
          onClick={proceed}
          disabled={continuing || running}
          className="ml-auto rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {continuing ? "Saving…" : "Continue to trip length →"}
        </button>
      </div>
    </div>
  );
}
