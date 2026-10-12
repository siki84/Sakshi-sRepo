import { z } from "zod";
import { getProfile, getTrip, updateTrip } from "@/lib/repo";
import { TimingSchema } from "@/lib/schemas";
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
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = getTrip(id);
  if (!trip) return Response.json({ error: "Trip not found" }, { status: 404 });
  const profile = getProfile();
  if (!profile) return Response.json({ error: "Set up your profile first" }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter 1–2 destinations and a time of year" }, { status: 400 });
  const { candidates, timing, mode } = parsed.data;
  const timingError = validateTiming(timing);
  if (timingError) return Response.json({ error: timingError }, { status: 400 });

  return sseResponse(async (send) => {
    const emit = (p: unknown) => send("progress", p);
    const prev = trip.state.destination;
    let result;
    if (mode === "alternatives" && prev?.result) {
      const alt = await findAlternatives(prev.result.candidates, prev.candidates, prev.timing, profile, emit);
      result = { ...prev.result, alternatives: alt.cards, alternativesNote: alt.note };
    } else {
      result = await runFit(candidates, timing, profile, emit);
    }
    const fresh = getTrip(id)!;
    updateTrip(id, {
      state: {
        destination: {
          candidates: mode === "alternatives" && prev ? prev.candidates : candidates,
          timing: mode === "alternatives" && prev ? prev.timing : timing,
          result,
          confirmed: fresh.state.destination?.confirmed ?? null,
        },
      },
    });
    send("result", result);
  });
}

