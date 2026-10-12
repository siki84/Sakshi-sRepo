import { geocode } from "../geo/nominatim";
import type { ProgressFn } from "../ai/client";
import { buildVariant, type City, type EngineInput } from "./engine";
import { recommendStays, writeNarrative } from "./ai";
import type { Activity, PlanState, Profile, Trip } from "../schemas";

export class PlanNotReady extends Error {}

/** Main city plus geocoded route stops, in order. */
export async function citiesFor(trip: Trip): Promise<City[]> {
  const dest = trip.state.destination?.confirmed;
  if (!dest) throw new PlanNotReady("Confirm a destination first.");
  const cities: City[] = [{ name: dest.place.name, lat: dest.place.lat, lng: dest.place.lng }];
  for (const s of dest.stops) {
    const hit = await geocode(s);
    if (hit) cities.push({ name: s, lat: hit.lat, lng: hit.lng });
  }
  return cities;
}

export function engineInput(trip: Trip, profile: Profile, cities: City[]): EngineInput {
  const { destination, interests, discover, length } = trip.state;
  if (!destination?.confirmed || !interests || !discover || !length?.chosenDays) {
    throw new PlanNotReady("Choose a trip length first.");
  }
  const card = [...(destination.result?.candidates ?? []), ...(destination.result?.alternatives ?? [])].find(
    (c) => c.place.name === destination.confirmed!.place.name,
  );
  return {
    pool: discover.pool,
    kept: discover.kept,
    removed: discover.removed,
    interests,
    days: length.chosenDays,
    startDate: length.startDate,
    cities,
    pace: profile.pace,
    climate: card?.climate ?? null,
    forecast: length.forecast,
  };
}

/** Two itineraries + where to stay. */
export async function generatePlan(trip: Trip, profile: Profile, emit: ProgressFn): Promise<PlanState> {
  emit({ type: "status", message: "Grouping your picks into days by neighborhood…" });
  const cities = await citiesFor(trip);
  const input = engineInput(trip, profile, cities);
  const byId = new Map<string, Activity>(input.pool.map((a) => [a.id, a]));
  let variants = [buildVariant(input, "frontload"), buildVariant(input, "easy")];
  const ctx = { profile, interests: input.interests, place: cities.map((c) => c.name).join(" → ") };
  variants = await writeNarrative(variants, byId, ctx, emit);
  let stays: PlanState["stays"] = [];
  try {
    stays = await recommendStays(variants[0], byId, cities, ctx, emit);
  } catch (e) {
    emit({ type: "status", message: `Couldn't research where to stay (${(e as Error).message}).` });
  }
  emit({ type: "status", message: "Done." });
  return {
    variants,
    chosen: null,
    stays,
    chat: [],
    basis: { days: input.days, startDate: input.startDate },
    updatedAt: new Date().toISOString(),
  };
}
