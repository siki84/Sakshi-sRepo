import Link from "next/link";
import { listTrips, getProfile } from "@/lib/repo";
import { PHASES } from "@/lib/schemas";
import { newTripAction, deleteTripAction } from "./actions";

export const dynamic = "force-dynamic";

export default function Home() {
  const trips = listTrips();
  const profile = getProfile();

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold">Plan a trip</h1>
        <p className="mt-1 text-slate-600">
          Compare destinations, discover what&apos;s worth doing, and get a map-based itinerary.
        </p>
        {!profile && (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Start by filling in your <Link href="/profile" className="underline">traveler profile</Link>{" "}
            — it&apos;s used to score weather, check visas, and set your pace.
          </p>
        )}
        <form action={newTripAction} className="mt-4">
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-white hover:bg-slate-700">
            + New trip
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Your trips</h2>
        {trips.length === 0 ? (
          <p className="text-slate-500">No trips yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
            {trips.map((t) => {
              const phase = PHASES.find((p) => p.n === t.phase) ?? PHASES[0];
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 p-4">
                  <Link href={`/trip/${t.id}/${phase.key}`} className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.title}</div>
                    <div className="text-sm text-slate-500">
                      Step {phase.n}: {phase.label} · updated {new Date(t.updatedAt).toLocaleDateString()}
                    </div>
                  </Link>
                  <form action={deleteTripAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="text-sm text-slate-400 hover:text-red-600" aria-label={`Delete ${t.title}`}>
                      Delete
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
