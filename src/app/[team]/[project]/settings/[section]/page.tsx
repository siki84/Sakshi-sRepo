"use client";

import { useParams } from "next/navigation";

export default function SettingsSectionPage() {
  const { section } = useParams<{ section: string }>();
  const title = section
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return (
    <div>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <div className="mt-6 flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-fg-muted">
        {title} settings aren&apos;t part of this replica yet.
      </div>
    </div>
  );
}
