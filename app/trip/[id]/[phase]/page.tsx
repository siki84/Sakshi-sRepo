import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getProfile, getTrip } from "@/lib/repo";
import { PHASES, type PhaseKey } from "@/lib/schemas";
import { WizardStepper } from "@/components/WizardStepper";
import { DestinationStep } from "@/components/destination/DestinationStep";
import { InterestsStep } from "@/components/interests/InterestsStep";
import { DiscoverStep } from "@/components/discover/DiscoverStep";
import { LengthStep } from "@/components/length/LengthStep";

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
      {trip.state.stale.includes(phase) && phase !== "discover" && phase !== "length" && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="status">
          ⚠︎ An earlier step changed since this one was made — refresh it to reflect your latest choices.
        </p>
      )}
      {phase === "destination" ? (
        <DestinationStep
          tripId={id}
          initial={trip.state.destination ?? null}
          units={profile.units}
          passports={profile.passports}
          profileDocs={profile.travelDocs}
        />
      ) : phase === "interests" ? (
        <InterestsStep
          tripId={id}
          initial={trip.state.interests ?? null}
          family={profile.travelers.type === "family"}
          destinationName={trip.state.destination?.confirmed?.place.name ?? null}
        />
      ) : phase === "discover" && trip.state.interests && trip.state.destination?.confirmed ? (
        <DiscoverStep
          tripId={id}
          initial={trip.state.discover ?? null}
          interests={trip.state.interests}
          center={trip.state.destination.confirmed.place}
          placeName={trip.state.destination.confirmed.place.name}
          stale={trip.state.stale.includes("discover")}
        />
      ) : phase === "length" && trip.state.destination?.confirmed ? (
        <LengthStep
          tripId={id}
          initial={trip.state.length ?? null}
          stale={trip.state.stale.includes("length")}
          timing={trip.state.destination.confirmed.timing}
          units={profile.units}
          names={Object.fromEntries((trip.state.discover?.pool ?? []).map((a) => [a.id, a.name]))}
        />
      ) : (
        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-medium">
            Step {meta.n}: {meta.label}
          </h2>
          <p className="mt-2 text-slate-500">This step is coming in a later milestone.</p>
        </section>
      )}
    </>
  );
}
