import { z } from "zod";
import { getProfile, getTrip, updateTrip } from "@/lib/repo";
import { moreLikeThis } from "@/lib/discover";
import { discoverInputFor } from "@/lib/discoverContext";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ activityId: z.string() });

/** POST: find more activities like one the traveler liked. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = getTrip(id);
  const profile = getProfile();
  if (!trip || !profile) return Response.json({ error: "Trip or profile not found" }, { status: 404 });
  const input = discoverInputFor(trip, profile);
  if ("error" in input) return Response.json({ error: input.error }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const state = trip.state.discover;
  const seed = state?.pool.find((a) => a.id === parsed.data?.activityId);
  if (!state || !seed) return Response.json({ error: "Activity not found" }, { status: 404 });

  return sseResponse(async (send) => {
    const found = await moreLikeThis(seed, state, input, (p) => send("progress", p));
    // Re-read: the traveler may have kept/removed things while this ran.
    const latest = getTrip(id)!.state.discover ?? state;
    const ids = new Set(latest.pool.map((a) => a.id));
    const added = found.filter((a) => !ids.has(a.id));
    updateTrip(id, { state: { discover: { ...latest, pool: [...latest.pool, ...added], updatedAt: new Date().toISOString() } } });
    send("result", { added });
  });
}
