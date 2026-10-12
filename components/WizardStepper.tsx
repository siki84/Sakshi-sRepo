import Link from "next/link";
import { PHASES, type PhaseKey } from "@/lib/schemas";

export function WizardStepper({
  tripId,
  current,
  reached,
  stale,
}: {
  tripId: string;
  current: PhaseKey;
  /** Highest phase number unlocked. */
  reached: number;
  stale: string[];
}) {
  return (
    <ol className="no-print flex gap-1 overflow-x-auto pb-1 text-sm" aria-label="Trip planning steps">
      {PHASES.map((p) => {
        const unlocked = p.n <= reached;
        const active = p.key === current;
        const isStale = stale.includes(p.key);
        const cls = active
          ? "bg-slate-900 text-white"
          : unlocked
            ? "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-100"
            : "bg-slate-100 text-slate-400";
        const body = (
          <span className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 ${cls}`}>
            <span className="font-mono text-xs opacity-70">{p.n}</span>
            {p.label}
            {isStale && <span title="Needs refresh — an earlier step changed">⚠︎</span>}
          </span>
        );
        return (
          <li key={p.key} aria-current={active ? "step" : undefined}>
            {unlocked ? <Link href={`/trip/${tripId}/${p.key}`}>{body}</Link> : body}
          </li>
        );
      })}
    </ol>
  );
}
