"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="no-print rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
      🖨 Print / save as PDF
    </button>
  );
}
