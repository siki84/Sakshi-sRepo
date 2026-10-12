import crypto from "node:crypto";
import { db } from "./db";

export function cacheKey(kind: string, parts: unknown): string {
  const h = crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
  return `${kind}:${h}`;
}

export function cacheGet<T>(key: string): T | undefined {
  const row = db()
    .prepare("SELECT payload, expires_at FROM research_cache WHERE key = ?")
    .get(key) as { payload: string; expires_at: string } | undefined;
  if (!row || new Date(row.expires_at) < new Date()) return undefined;
  return JSON.parse(row.payload) as T;
}

export function cacheSet(key: string, payload: unknown, ttlDays: number) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 86_400_000);
  db()
    .prepare(
      `INSERT INTO research_cache (key, kind, payload, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload,
         created_at = excluded.created_at, expires_at = excluded.expires_at`,
    )
    .run(key, key.split(":")[0], JSON.stringify(payload), now.toISOString(), expires.toISOString());
}

/** Return the cached value, or compute + store it. */
export async function cached<T>(key: string, ttlDays: number, compute: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await compute();
  cacheSet(key, value, ttlDays);
  return value;
}
