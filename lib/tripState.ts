import type { DestinationState, Trip, TripState } from "./schemas";

/** Phases (in order) whose data depends on the destination. */
const AFTER_DESTINATION = ["discover", "length", "plan"] as const;

export function sameDestination(a: DestinationState["confirmed"], b: DestinationState["confirmed"]): boolean {
  if (!a || !b) return false;
  return (
    a.place.name === b.place.name &&
    JSON.stringify(a.stops) === JSON.stringify(b.stops) &&
    JSON.stringify(a.timing) === JSON.stringify(b.timing)
  );
}

/**
 * Applying a newly confirmed destination. A changed destination wipes research-based phases
 * (discovery, length, plan) — they'd be wrong for a different place — but keeps interests.
 */
export function withConfirmedDestination(
  trip: Trip,
  confirmed: NonNullable<DestinationState["confirmed"]>,
  dest: Omit<DestinationState, "confirmed">,
): { state: Partial<TripState>; phase: number } {
  const prev = trip.state.destination?.confirmed ?? null;
  const changed = !sameDestination(prev, confirmed);
  const state: Partial<TripState> = { destination: { ...dest, confirmed } };
  if (changed && prev) {
    for (const k of AFTER_DESTINATION) state[k] = undefined;
    state.stale = trip.state.stale.filter((s) => !AFTER_DESTINATION.includes(s as (typeof AFTER_DESTINATION)[number]));
  }
  const interestsDone = Boolean(trip.state.interests);
  const phase = changed ? (interestsDone ? 3 : 2) : Math.max(trip.phase, 2);
  return { state, phase };
}
