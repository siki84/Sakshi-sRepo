import { customAlphabet } from "nanoid";
import { db } from "./db";
import { ProfileSchema, TripStateSchema, type Profile, type Trip, type TripState } from "./schemas";

const newId = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 10);

export function getProfile(): Profile | null {
  const row = db().prepare("SELECT data FROM profile WHERE id = 1").get() as
    | { data: string }
    | undefined;
  if (!row) return null;
  const parsed = ProfileSchema.safeParse(JSON.parse(row.data));
  return parsed.success ? parsed.data : null;
}

export function saveProfile(p: Profile): Profile {
  const data = ProfileSchema.parse(p);
  db()
    .prepare(
      `INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(data), new Date().toISOString());
  return data;
}

type TripRow = {
  id: string;
  share_id: string;
  title: string;
  phase: number;
  state: string;
  created_at: string;
  updated_at: string;
};

function toTrip(r: TripRow): Trip {
  return {
    id: r.id,
    shareId: r.share_id,
    title: r.title,
    phase: r.phase,
    state: TripStateSchema.parse(JSON.parse(r.state)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createTrip(title = "Untitled trip"): Trip {
  const now = new Date().toISOString();
  const row: TripRow = {
    id: newId(),
    share_id: newId() + newId(),
    title,
    phase: 1,
    state: JSON.stringify(TripStateSchema.parse({})),
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(
      `INSERT INTO trips (id, share_id, title, phase, state, created_at, updated_at)
       VALUES (@id, @share_id, @title, @phase, @state, @created_at, @updated_at)`,
    )
    .run(row);
  return toTrip(row);
}

export function listTrips(): Trip[] {
  return (db().prepare("SELECT * FROM trips ORDER BY updated_at DESC").all() as TripRow[]).map(toTrip);
}

export function getTrip(id: string): Trip | null {
  const row = db().prepare("SELECT * FROM trips WHERE id = ?").get(id) as TripRow | undefined;
  return row ? toTrip(row) : null;
}

export function getTripByShareId(shareId: string): Trip | null {
  const row = db().prepare("SELECT * FROM trips WHERE share_id = ?").get(shareId) as
    | TripRow
    | undefined;
  return row ? toTrip(row) : null;
}

export function updateTrip(
  id: string,
  patch: { title?: string; phase?: number; state?: Partial<TripState> },
): Trip {
  const current = getTrip(id);
  if (!current) throw new Error(`Trip ${id} not found`);
  const state = TripStateSchema.parse({ ...current.state, ...patch.state });
  db()
    .prepare("UPDATE trips SET title = ?, phase = ?, state = ?, updated_at = ? WHERE id = ?")
    .run(
      patch.title ?? current.title,
      patch.phase ?? current.phase,
      JSON.stringify(state),
      new Date().toISOString(),
      id,
    );
  return getTrip(id)!;
}

export function deleteTrip(id: string) {
  db().prepare("DELETE FROM trips WHERE id = ?").run(id);
}
