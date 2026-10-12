import type { Trip, Profile, Climate } from "./schemas";
import type { DiscoverInput } from "./discover";

/** Everything discovery needs from earlier phases, or a user-facing reason it's not ready. */
export function discoverInputFor(trip: Trip, profile: Profile): Omit<DiscoverInput, "previous"> | { error: string } {
  const dest = trip.state.destination;
  const confirmed = dest?.confirmed;
  if (!confirmed) return { error: "Confirm a destination first." };
  const interests = trip.state.interests;
  if (!interests) return { error: "Pick your interests first." };
  const card = [...(dest.result?.candidates ?? []), ...(dest.result?.alternatives ?? [])].find(
    (c) => c.place.name === confirmed.place.name,
  );
  const climate: Climate | null = card?.climate ?? null;
  return {
    place: confirmed.place,
    stops: confirmed.stops,
    timing: confirmed.timing,
    climate,
    profile: { ...profile, travelDocs: dest.travelDocs ?? profile.travelDocs },
    interests,
  };
}
