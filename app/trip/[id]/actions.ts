"use server";

import { revalidatePath } from "next/cache";
import { getTrip, updateTrip } from "@/lib/repo";
import { PlaceSchema, TimingSchema } from "@/lib/schemas";
import { withConfirmedDestination } from "@/lib/tripState";
import { describeTiming } from "@/lib/timing";
import { z } from "zod";

const ConfirmInput = z.object({
  tripId: z.string(),
  placeName: z.string(),
  stops: z.array(z.string().trim().min(2).max(80)).max(5),
});

export async function confirmDestinationAction(input: z.input<typeof ConfirmInput>) {
  const { tripId, placeName, stops } = ConfirmInput.parse(input);
  const trip = getTrip(tripId);
  const dest = trip?.state.destination;
  if (!trip || !dest?.result) return { ok: false as const, error: "Run the comparison first" };
  const card = [...dest.result.candidates, ...dest.result.alternatives].find((c) => c.place.name === placeName);
  if (!card) return { ok: false as const, error: "That destination isn't in your results" };

  const confirmed = { place: PlaceSchema.parse(card.place), stops, timing: TimingSchema.parse(dest.timing) };
  const { state, phase } = withConfirmedDestination(trip, confirmed, {
    candidates: dest.candidates,
    timing: dest.timing,
    travelDocs: dest.travelDocs,
    result: dest.result,
  });
  const route = stops.length ? ` + ${stops.length} stop${stops.length > 1 ? "s" : ""}` : "";
  updateTrip(tripId, { title: `${card.place.name}${route} · ${describeTiming(dest.timing)}`, phase, state });
  revalidatePath(`/trip/${tripId}`, "layout");
  return { ok: true as const };
}
