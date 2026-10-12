import { z } from "zod";
import { getProfile, getTrip, saveProfile, updateTrip } from "@/lib/repo";
import { TimingSchema, TravelDocsSchema } from "@/lib/schemas";
import { validateTiming } from "@/lib/timing";
import { runFit, findAlternatives } from "@/lib/fit";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  candidates: z.array(z.string().trim().min(2).max(120)).min(1).max(2),
  timing: TimingSchema,
  /** "alternatives": keep current results and (re)run the alternatives search only. */
  mode: z.enum(["full", "alternatives"]).default("full"),
  /** Travel documents/restrictions the traveler confirmed just before this run. */
  travelDocs: TravelDocsSchema,
  /** Also store them on the profile for future trips. */
  saveToProfile: z.boolean().default(false),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = getTrip(id);
  if (!trip) return Response.json({ error: "Trip not found" }, { status: 404 });
  const profile = getProfile();
  if (!profile) return Response.json({ error: "Set up your profile first" }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter 1–2 destinations and a time of year" }, { status: 400 });
  const { candidates, timing, mode, saveToProfile } = parsed.data;
  // Alternatives reuse whatever was confirmed for the original comparison.
  const travelDocs =
    mode === "alternatives" && trip.state.destination?.travelDocs ? trip.state.destination.travelDocs : parsed.data.travelDocs;
  if (saveToProfile) saveProfile({ ...profile, travelDocs });
  const effectiveProfile = { ...profile, travelDocs };
  const timingError = validateTiming(timing);
  if (timingError) return Response.json({ error: timingError }, { status: 400 });

  return sseResponse(async (send) => {
    const emit = (p: unknown) => send("progress", p);
    const prev = trip.state.destination;
    let result;
    if (mode === "alternatives" && prev?.result) {
      const alt = await findAlternatives(prev.result.candidates, prev.candidates, prev.timing, effectiveProfile, emit);
      result = { ...prev.result, alternatives: alt.cards, alternativesNote: alt.note };
    } else {
      result = await runFit(candidates, timing, effectiveProfile, emit);
    }
    const fresh = getTrip(id)!;
    updateTrip(id, {
      state: {
        destination: {
          candidates: mode === "alternatives" && prev ? prev.candidates : candidates,
          timing: mode === "alternatives" && prev ? prev.timing : timing,
          travelDocs,
          result,
          confirmed: fresh.state.destination?.confirmed ?? null,
        },
      },
    });
    send("result", result);
  });
}

