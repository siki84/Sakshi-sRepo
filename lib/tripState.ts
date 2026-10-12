import type { DestinationState, InterestsState, Trip, TripState } from "./schemas";

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

/**
 * Applying new interests. Discovery is only stale if the *set* of interests changed
 * (it may need new research); a different mix or requirements just re-ranks it.
 * Trip length and the plan depend on everything, so they go stale on any change.
 */
export function withInterests(trip: Trip, next: InterestsState): { state: Partial<TripState>; phase: number } {
  const prev = trip.state.interests;
  const stale = new Set(trip.state.stale);
  stale.delete("interests");
  if (prev && JSON.stringify(prev) !== JSON.stringify(next)) {
    const chipSet = (s: InterestsState) => JSON.stringify([...s.chips].sort());
    if (trip.state.discover && chipSet(prev) !== chipSet(next)) stale.add("discover");
    if (trip.state.length) stale.add("length");
    if (trip.state.plan) stale.add("plan");
  }
  return { state: { interests: next, stale: [...stale] }, phase: Math.max(trip.phase, 3) };
}
