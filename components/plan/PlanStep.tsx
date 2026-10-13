"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Progress } from "@/lib/ai/client";
import type { Activity, InterestsState, Itinerary, PlanState } from "@/lib/schemas";
import { postSse } from "@/lib/sseClient";
import { choosePlanVariantAction, moveActivityAction, refineChatAction } from "@/app/trip/[id]/actions";
import { ProgressLog } from "../ProgressLog";
import { MixCompare, PlanView, type MoveTarget } from "./PlanView";

const CHAT_EXAMPLES = ["Swap day 2 and 3", "Make day 2 lighter", "Add a coffee stop", "Move the museum to the morning"];

function stops(it: Itinerary) {
  return it.days.reduce((s, d) => s + d.blocks.morning.length + d.blocks.afternoon.length + d.blocks.evening.length, 0);
}

export function PlanStep({
  tripId,
  shareId,
  initial,
  activities,
  interests,
  center,
  units,
  stale,
  chosenDays,
}: {
  tripId: string;
  shareId: string;
  initial: PlanState | null;
  activities: Record<string, Activity>;
  interests: InterestsState;
  center: { lat: number; lng: number };
  units: "F" | "C";
  stale: boolean;
  chosenDays: number;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanState | null>(initial);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [chatting, startChat] = useTransition();
  const [copied, setCopied] = useState(false);

  async function build() {
    setRunning(true);
    setError(null);
    setProgress([]);
    try {
      await postSse(`/api/trips/${tripId}/plan`, {}, (event, data) => {
        if (event === "progress") setProgress((p) => [...p, data as Progress]);
        else if (event === "result") {
          setPlan(data as PlanState);
          router.refresh();
        } else if (event === "error") setError((data as { message: string }).message);
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function choose(i: 0 | 1 | null) {
    if (!plan) return;
    setPlan({ ...plan, chosen: i });
    await choosePlanVariantAction(tripId, i);
  }

  async function move(id: string, t: MoveTarget) {
    const res = await moveActivityAction({ tripId, activityId: id, toDay: t.toDay, block: t.block });
    if (res.ok) {
      setPlan(res.plan);
      setNotice(res.warnings);
    } else setError(res.error);
  }

  function send(text: string) {
    if (!text.trim()) return;
    setMsg("");
    startChat(async () => {
      const res = await refineChatAction(tripId, text);
      if (res.ok) {
        setPlan(res.plan);
        setNotice([]);
      } else setError(res.error);
    });
  }

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/share/${shareId}` : `/share/${shareId}`;

  if (!plan) {
    return (
      <div className="space-y-4">
        <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-medium">Your {chosenDays}-day plan</h2>
          <p className="text-sm text-slate-600">
            We&apos;ll group your picks into days by neighborhood, order each day&apos;s route, place outdoor things on drier or cooler
            times, and give you two different shapes to choose from — plus where to stay.
          </p>
          <button
            type="button"
            onClick={build}
            disabled={running}
            className="rounded-lg bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {running ? "Planning…" : "Build my itineraries"}
          </button>
          {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
        </section>
        <ProgressLog items={progress} running={running} />
      </div>
    );
  }

  const staleBanner = stale && (
    <div className="flex flex-wrap items-center gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
      Earlier choices changed since this plan was built.
      <button type="button" onClick={build} disabled={running} className="rounded bg-amber-600 px-3 py-1 text-white disabled:opacity-50">
        {running ? "Rebuilding…" : "Rebuild plan (discards edits)"}
      </button>
    </div>
  );

  if (plan.chosen === null) {
    return (
      <div className="space-y-4">
        {staleBanner}
        <h2 className="text-lg font-medium">Two ways to spend {plan.basis.days} days — pick one to refine</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {plan.variants.map((v, i) => (
            <article key={v.key} aria-label={`Plan: ${v.name}`} className="flex flex-col gap-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div>
                <h3 className="text-lg font-semibold">{v.name}</h3>
                <p className="text-sm text-slate-600">{v.tagline}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {stops(v)} stops · {v.days.filter((d) => d.sprawl).length} spread-out day{v.days.filter((d) => d.sprawl).length === 1 ? "" : "s"} ·{" "}
                  {v.checks.some((c) => c.status !== "info")
                    ? `${v.checks.filter((c) => c.status === "met").length}/${v.checks.filter((c) => c.status !== "info").length} requirements met`
                    : "no checkable requirements"}
                </p>
              </div>
              {stops(v) === 0 && (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                  None of your picks could be placed in this plan. Keep a few more on Discover, or try a different length.
                </p>
              )}
              <ol className="space-y-1 text-sm">
                {v.days.map((d) => (
                  <li key={d.n} className="flex gap-2">
                    <span className="w-12 shrink-0 text-slate-500">Day {d.n}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{d.title}</span>
                      <span className="text-slate-500">
                        {" "}
                        · {d.blocks.morning.length + d.blocks.afternoon.length + d.blocks.evening.length} stops
                        {d.sprawl ? " · ⚠" : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <MixCompare achieved={v.achievedMix} target={interests.mix} interests={interests} />
              <button
                type="button"
                onClick={() => choose(i as 0 | 1)}
                className="mt-auto rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
              >
                Choose “{v.name}”
              </button>
            </article>
          ))}
        </div>
      </div>
    );
  }

  const it = plan.variants[plan.chosen];
  return (
    <div className="space-y-5">
      {staleBanner}
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div>
          <h2 className="text-lg font-semibold">{it.name}</h2>
          <p className="text-sm text-slate-600">{it.tagline}</p>
          <button type="button" onClick={() => choose(plan.chosen === 0 ? 1 : 0)} className="mt-1 text-xs text-slate-500 underline">
            Switch to “{plan.variants[plan.chosen === 0 ? 1 : 0].name}”
          </button>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(shareUrl).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200"
          >
            {copied ? "✓ Link copied" : "🔗 Copy share link"}
          </button>
          <a href={`/share/${shareId}`} target="_blank" className="rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200">
            👁 View shared page
          </a>
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200">
            🖨 Print
          </button>
        </div>
      </section>

      {notice.length > 0 && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="status">
          {notice.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}

      <section className="no-print space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="Refine with chat">
        <h3 className="text-sm font-medium">💬 Refine your plan</h3>
        {plan.chat.length > 0 && (
          <ul className="max-h-60 space-y-2 overflow-y-auto text-sm" data-testid="chat-log">
            {plan.chat.map((m, i) => (
              <li key={i} className={m.role === "user" ? "text-right" : ""}>
                <span
                  className={`inline-block max-w-[85%] whitespace-pre-line rounded-xl px-3 py-1.5 text-left ${
                    m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"
                  }`}
                >
                  {m.text}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-1.5">
          {CHAT_EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => send(ex)} disabled={chatting} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs hover:bg-slate-200 disabled:opacity-50">
              {ex}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(msg);
          }}
          className="flex gap-2"
        >
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            maxLength={500}
            placeholder='e.g. "add a coffee crawl on day 3" or "make day 4 lighter"'
            aria-label="Chat message"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button disabled={chatting || !msg.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {chatting ? "…" : "Send"}
          </button>
        </form>
        <p className="text-xs text-slate-500">Or drag stops between days (⠿ handle) or use Move… — the plan re-checks distances after every change.</p>
      </section>

      <PlanView itinerary={it} activities={activities} stays={plan.stays} interests={interests} center={center} units={units} editable onMove={move} />
    </div>
  );
}
