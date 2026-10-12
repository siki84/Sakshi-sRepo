import { getProfile, getTrip, updateTrip } from "@/lib/repo";
import { generatePlan } from "@/lib/plan";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST: build two itineraries + where to stay. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = getTrip(id);
  const profile = getProfile();
  if (!trip || !profile) return Response.json({ error: "Trip or profile not found" }, { status: 404 });
  if (!trip.state.length?.chosenDays) return Response.json({ error: "Choose a trip length first." }, { status: 400 });

  return sseResponse(async (send) => {
    const plan = await generatePlan(trip, profile, (p) => send("progress", p));
    const fresh = getTrip(id)!;
    updateTrip(id, { state: { plan, stale: fresh.state.stale.filter((s) => s !== "plan") } });
    send("result", plan);
  });
}
