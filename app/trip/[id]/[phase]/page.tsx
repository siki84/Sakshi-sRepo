import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getProfile, getTrip } from "@/lib/repo";
import { PHASES, type PhaseKey } from "@/lib/schemas";
import { WizardStepper } from "@/components/WizardStepper";

export const dynamic = "force-dynamic";

export default async function PhasePage({ params }: { params: Promise<{ id: string; phase: string }> }) {
  const { id, phase } = await params;
  const trip = getTrip(id);
  if (!trip) notFound();
  const meta = PHASES.find((p) => p.key === phase);
  if (!meta) notFound();
  if (meta.n > trip.phase) redirect(`/trip/${id}/${PHASES[trip.phase - 1].key}`);

  const profile = getProfile();
  if (!profile) {
    return (
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold">First, a quick profile</h1>
        <p className="mt-2 text-slate-600">
          Your home city, passport, weather likes and dislikes, and pace shape every recommendation.
          It takes about a minute and is reused for every trip.
        </p>
        <Link
          href={`/profile?next=${encodeURIComponent(`/trip/${id}/${phase}`)}`}
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
        >
          Set up my profile
        </Link>
      </section>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">{trip.title}</h1>
      </div>
      <WizardStepper tripId={id} current={phase as PhaseKey} reached={trip.phase} stale={trip.state.stale} />
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-medium">
          Step {meta.n}: {meta.label}
        </h2>
        <p className="mt-2 text-slate-500">This step is coming in a later milestone.</p>
      </section>
    </>
  );
}
