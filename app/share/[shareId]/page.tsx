import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProfile, getTripByShareId } from "@/lib/repo";
import { PlanView } from "@/components/plan/PlanView";
import { PrintButton } from "@/components/plan/PrintButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ shareId: string }> }): Promise<Metadata> {
  const { shareId } = await params;
  const trip = getTripByShareId(shareId);
  return { title: trip ? `${trip.title} — Wayfarer` : "Trip — Wayfarer", robots: { index: false } };
}

/** Read-only, print-friendly view of a trip's chosen itinerary. */
export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const trip = getTripByShareId(shareId);
  if (!trip) notFound();
  const plan = trip.state.plan;
  const dest = trip.state.destination?.confirmed;
  const interests = trip.state.interests;
  if (!plan || plan.chosen === null || !dest || !interests) {
    return <p className="rounded-xl bg-white p-5 text-slate-600 ring-1 ring-slate-200">This trip&apos;s plan isn&apos;t ready yet.</p>;
  }
  const it = plan.variants[plan.chosen];
  const activities = Object.fromEntries((trip.state.discover?.pool ?? []).map((a) => [a.id, a]));
  const units = getProfile()?.units ?? "F";
  const length = trip.state.length;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Shared itinerary · read-only</p>
          <h1 className="text-2xl font-semibold">{trip.title}</h1>
          <p className="text-sm text-slate-600">
            {it.name} · {plan.basis.days} days
            {length?.startDate ? ` from ${new Date(`${length.startDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}` : ""}
          </p>
          <p className="text-sm text-slate-500">{it.tagline}</p>
        </div>
        <PrintButton />
      </header>
      <PlanView itinerary={it} activities={activities} stays={plan.stays} interests={interests} center={dest.place} units={units} />
      <footer className="border-t border-slate-200 pt-3 text-xs text-slate-500">
        Recommendations come from web research with linked sources; check opening hours and entry rules before you go. Made with Wayfarer.
      </footer>
    </div>
  );
}
