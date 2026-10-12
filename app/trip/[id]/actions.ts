"use server";

import { revalidatePath } from "next/cache";
import { getProfile, getTrip, updateTrip } from "@/lib/repo";
import { computeLength } from "@/lib/tripLength";
import { citiesFor } from "@/lib/plan";
import { finalizeItinerary } from "@/lib/plan/engine";
import { applyOps, editWarnings, placeActivity, removeActivity } from "@/lib/plan/edit";
import { interpretChat } from "@/lib/plan/ai";
import { rankActivities } from "@/lib/rank";
import type { Itinerary, PlanState } from "@/lib/schemas";
import { getDailyForecast } from "@/lib/weather/openMeteo";
import { PlaceSchema, TimingSchema } from "@/lib/schemas";
import { withConfirmedDestination, withInterests } from "@/lib/tripState";
import { InterestsStateSchema, GroupSchema, type InterestsState } from "@/lib/schemas";
import { activeGroups, reconcileMix, type Mix } from "@/lib/interests";
import { applyRules, interpretRequirements } from "@/lib/requirements";
import { describeTiming, forecastWindow, isoDay } from "@/lib/timing";
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

// ---------- Phase 4: trip length ----------

export async function computeLengthAction(tripId: string) {
  const trip = getTrip(tripId);
  const profile = getProfile();
  if (!trip || !profile) return { ok: false as const, error: "Trip or profile not found" };
  try {
    const length = await computeLength(trip, profile);
    const stale = getTrip(tripId)!.state.stale.filter((s) => s !== "length");
    updateTrip(tripId, { state: { length, stale } });
    return { ok: true as const, length };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

/** Forecast preview for a start date + length (only when the trip starts within 14 days). */
export async function previewForecastAction(tripId: string, startDate: string, days: number) {
  const trip = getTrip(tripId);
  const place = trip?.state.destination?.confirmed?.place;
  if (!place || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || days < 1) return { ok: true as const, forecast: null };
  const end = isoDay(new Date(new Date(`${startDate}T00:00:00Z`).getTime() + (days - 1) * 86_400_000));
  const window = forecastWindow({ kind: "dates", start: startDate, end });
  if (!window) return { ok: true as const, forecast: null };
  try {
    return { ok: true as const, forecast: await getDailyForecast(place.lat, place.lng, window) };
  } catch (e) {
    return { ok: false as const, error: `Couldn't fetch the forecast: ${(e as Error).message}` };
  }
}

const ConfirmLengthInput = z.object({
  tripId: z.string(),
  days: z.number().int().min(1).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function confirmLengthAction(input: z.input<typeof ConfirmLengthInput>) {
  const { tripId, days, startDate } = ConfirmLengthInput.parse(input);
  const trip = getTrip(tripId);
  const length = trip?.state.length;
  if (!trip || !length) return { ok: false as const, error: "Work out the trip length first" };
  if (startDate && startDate < isoDay(new Date())) return { ok: false as const, error: "That start date is in the past" };
  const fc = startDate ? await previewForecastAction(tripId, startDate, days) : { ok: true as const, forecast: null };
  const forecast = fc.ok ? fc.forecast : null;
  const changed = length.chosenDays !== days || length.startDate !== startDate;
  const stale = new Set(trip.state.stale);
  stale.delete("length");
  if (changed && trip.state.plan) stale.add("plan");
  updateTrip(tripId, {
    phase: Math.max(trip.phase, 5),
    state: { length: { ...length, chosenDays: days, startDate, forecast }, stale: [...stale] },
  });
  revalidatePath(`/trip/${tripId}`, "layout");
  return { ok: true as const };
}

// ---------- Phase 5: the plan ----------

function planContext(tripId: string) {
  const trip = getTrip(tripId);
  const plan = trip?.state.plan;
  const discover = trip?.state.discover;
  const interests = trip?.state.interests;
  if (!trip || !plan || plan.chosen === null || !discover || !interests) return null;
  const byId = new Map(discover.pool.map((a) => [a.id, a]));
  return { trip, plan, discover, interests, byId, chosen: plan.variants[plan.chosen] };
}

function savePlanVariant(tripId: string, plan: PlanState, itinerary: Itinerary, chat?: PlanState["chat"]) {
  const variants = plan.variants.map((v, i) => (i === plan.chosen ? itinerary : v));
  const next = { ...plan, variants, chat: chat ?? plan.chat, updatedAt: new Date().toISOString() };
  updateTrip(tripId, { state: { plan: next } });
  return next;
}

export async function choosePlanVariantAction(tripId: string, index: 0 | 1 | null) {
  const trip = getTrip(tripId);
  if (!trip?.state.plan) return { ok: false as const };
  updateTrip(tripId, { state: { plan: { ...trip.state.plan, chosen: index } } });
  revalidatePath(`/trip/${tripId}`, "layout");
  return { ok: true as const };
}

const MoveInput = z.object({
  tripId: z.string(),
  activityId: z.string(),
  /** null = move to Optional */
  toDay: z.number().int().nullable(),
  block: z.enum(["morning", "afternoon", "evening"]).nullable(),
});

/** Drag & drop / "Move to…": place an activity, then re-check the plan. */
export async function moveActivityAction(input: z.input<typeof MoveInput>) {
  const { tripId, activityId, toDay, block } = MoveInput.parse(input);
  const ctx = planContext(tripId);
  if (!ctx || !ctx.byId.has(activityId)) return { ok: false as const, error: "Choose a plan first" };
  const cities = await citiesFor(ctx.trip);
  const edited = toDay === null ? removeActivity(ctx.chosen, activityId) : placeActivity(ctx.chosen, activityId, toDay, block, ctx.byId);
  const itinerary = finalizeItinerary(edited, ctx.byId, ctx.interests, cities);
  const plan = savePlanVariant(tripId, ctx.plan, itinerary);
  return { ok: true as const, plan, warnings: editWarnings(ctx.chosen, itinerary) };
}

/** Chat refinement: Claude proposes edit ops, the app applies and re-checks them. */
export async function refineChatAction(tripId: string, message: string) {
  const text = message.trim().slice(0, 500);
  const ctx = planContext(tripId);
  const profile = getProfile();
  if (!ctx || !profile || !text) return { ok: false as const, error: "Choose a plan first" };
  const inPlan = new Set(ctx.chosen.days.flatMap((d) => [...d.blocks.morning, ...d.blocks.afternoon, ...d.blocks.evening]));
  const ranked = rankActivities(ctx.discover.pool, ctx.interests, ctx.discover.removed);
  const candidates = [
    ...ctx.chosen.optional.map((id) => ctx.byId.get(id)!).filter(Boolean),
    ...ranked.filter((a) => !inPlan.has(a.id) && !ctx.chosen.optional.includes(a.id)),
  ].slice(0, 40);
  try {
    const ops = await interpretChat(text, ctx.chosen, ctx.byId, candidates, {
      profile,
      interests: ctx.interests,
      history: ctx.plan.chat,
    });
    const cities = await citiesFor(ctx.trip);
    const { itinerary } = applyOps(ctx.chosen, ops, {
      byId: ctx.byId,
      interests: ctx.interests,
      cities,
      kept: new Set(ctx.discover.kept),
    });
    const warnings = editWarnings(ctx.chosen, itinerary);
    const now = new Date().toISOString();
    const reply = [ops.reply, ...warnings].join("\n");
    const chat = [...ctx.plan.chat, { role: "user" as const, text, at: now }, { role: "assistant" as const, text: reply, at: now }];
    const plan = savePlanVariant(tripId, ctx.plan, itinerary, chat);
    return { ok: true as const, plan };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}
