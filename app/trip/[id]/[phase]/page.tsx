import { notFound, redirect } from "next/navigation";
import { getTrip } from "@/lib/repo";
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
