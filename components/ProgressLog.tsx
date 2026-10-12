"use client";

import type { Progress } from "@/lib/ai/client";

export function ProgressLog({ items, running }: { items: Progress[]; running: boolean }) {
  if (!items.length && !running) return null;
  const recent = items.slice(-8);
  return (
    <div className="rounded-xl bg-slate-900 p-4 font-mono text-xs text-slate-200" aria-live="polite" data-testid="progress-log">
      {running && (
        <div className="mb-2 flex items-center gap-2 text-slate-400">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Researching — this can take a minute or two…
        </div>
      )}
      <ul className="space-y-1">
        {recent.map((p, i) => (
          <li key={items.length - recent.length + i} className="truncate">
            {p.type === "search" ? `🔎 ${p.query}` : `• ${p.message}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
