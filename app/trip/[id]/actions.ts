"use server";

import { revalidatePath } from "next/cache";
import { getTrip, updateTrip } from "@/lib/repo";
import { PlaceSchema, TimingSchema } from "@/lib/schemas";
import { withConfirmedDestination, withInterests } from "@/lib/tripState";
import { InterestsStateSchema, GroupSchema, type InterestsState } from "@/lib/schemas";
import { activeGroups, reconcileMix, type Mix } from "@/lib/interests";
import { applyRules, interpretRequirements } from "@/lib/requirements";
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

const InterestsInput = z.object({
  tripId: z.string(),
  chips: z.array(z.string()).max(40),
  custom: z.array(z.object({ key: z.string(), label: z.string().trim().min(1).max(40), group: GroupSchema })).max(12),
  mix: z.record(z.string(), z.number()),
  requirements: z.array(z.string()).max(10),
});

export type SaveInterestsResult =
  | { ok: true; interests: InterestsState }
  | { ok: false; error: string };

export async function saveInterestsAction(input: z.input<typeof InterestsInput>): Promise<SaveInterestsResult> {
  const parsed = InterestsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something's off with those interests — try again." };
  const { tripId, custom } = parsed.data;
  const trip = getTrip(tripId);
  if (!trip) return { ok: false, error: "Trip not found" };

  const requirements = parsed.data.requirements.map((r) => r.trim()).filter((r) => r.length >= 2);
  if (!activeGroups(parsed.data.chips, custom).length) {
    return { ok: false, error: "Pick at least one interest (not just Kid-friendly / Accessible)." };
  }

  let rules;
  try {
    rules = await interpretRequirements(requirements, custom, {
      destination: trip.state.destination?.confirmed?.place.name ?? null,
    });
  } catch (e) {
    return { ok: false, error: `Couldn't interpret your requirements: ${(e as Error).message}` };
  }
  const { chips, notices } = applyRules(parsed.data.chips, rules, custom);
  const groups = activeGroups(chips, custom);
  if (!groups.length) return { ok: false, error: "Your requirements excluded every interest you picked." };
  const mix = reconcileMix(parsed.data.mix as Mix, groups);

  const interests = InterestsStateSchema.parse({ chips, custom, mix, requirements, rules, notices });
  const { state, phase } = withInterests(trip, interests);
  updateTrip(tripId, { state, phase });
  revalidatePath(`/trip/${tripId}`, "layout");
  return { ok: true, interests };
}

const ActivityStatusInput = z.object({
  tripId: z.string(),
  activityId: z.string(),
  status: z.enum(["kept", "removed", "none"]),
});

/** ❤️ keep / ✕ remove / restore an activity. */
export async function setActivityStatusAction(input: z.input<typeof ActivityStatusInput>) {
  const { tripId, activityId, status } = ActivityStatusInput.parse(input);
  const trip = getTrip(tripId);
  const d = trip?.state.discover;
  if (!trip || !d || !d.pool.some((a) => a.id === activityId)) return { ok: false as const };
  const kept = d.kept.filter((x) => x !== activityId);
  const removed = d.removed.filter((x) => x !== activityId);
  if (status === "kept") kept.push(activityId);
  if (status === "removed") removed.push(activityId);
  // Length and plan were built from the old selection.
  const stale = new Set(trip.state.stale);
  if (trip.state.length) stale.add("length");
  if (trip.state.plan) stale.add("plan");
  updateTrip(tripId, { state: { discover: { ...d, kept, removed }, stale: [...stale] } });
  return { ok: true as const };
}

export async function confirmDiscoveryAction(tripId: string) {
  const trip = getTrip(tripId);
  if (!trip?.state.discover?.pool.length) return { ok: false as const, error: "Run discovery first" };
  updateTrip(tripId, { phase: Math.max(trip.phase, 4) });
  revalidatePath(`/trip/${tripId}`, "layout");
  return { ok: true as const };
}
