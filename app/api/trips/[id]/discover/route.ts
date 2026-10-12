import { getProfile, getTrip, updateTrip } from "@/lib/repo";
import { runDiscovery } from "@/lib/discover";
import { discoverInputFor } from "@/lib/discoverContext";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST: research the activity pool (or refresh only what changed since last time). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = getTrip(id);
  const profile = getProfile();
  if (!trip || !profile) return Response.json({ error: "Trip or profile not found" }, { status: 404 });
  const input = discoverInputFor(trip, profile);
  if ("error" in input) return Response.json({ error: input.error }, { status: 400 });

  return sseResponse(async (send) => {
    const state = await runDiscovery({ ...input, previous: trip.state.discover }, (p) => send("progress", p));
    const fresh = getTrip(id)!;
    updateTrip(id, { state: { discover: state, stale: fresh.state.stale.filter((s) => s !== "discover") } });
    send("result", state);
  });
}
