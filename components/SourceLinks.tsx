import type { SourceRef } from "@/lib/schemas";

function host(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourceLinks({ sources, label = "Sources" }: { sources: SourceRef[]; label?: string }) {
  if (!sources.length) return <span className="text-xs italic text-amber-700">No verified source</span>;
  return (
    <span className="text-xs text-slate-500">
      {label}:{" "}
      {sources.map((s, i) => (
        <span key={s.url}>
          {i > 0 && ", "}
          <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.title} className="underline hover:text-slate-800">
            {host(s.url)}
          </a>
        </span>
      ))}
    </span>
  );
}
