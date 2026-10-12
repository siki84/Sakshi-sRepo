import { db } from "../db";
import { fetchJson, isMockExternal } from "../http";
import type { Place } from "../schemas";
import { mockGeocode } from "./fixtures";

type NominatimResult = {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
};

// Nominatim usage policy: max 1 request/second, identify the app in User-Agent.
let queue: Promise<unknown> = Promise.resolve();
let last = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

export function shortName(r: NominatimResult): string {
  const a = r.address ?? {};
  const local = r.name || a.city || a.town || a.village || a.municipality || a.county || a.state;
  const country = a.country;
  if (local && country && local !== country) return `${local}, ${country}`;
  return local || country || r.display_name.split(",").slice(0, 2).join(",").trim();
}

/**
 * Geocode a free-text place. Results (including misses) are cached in SQLite.
 * `countryCodes` restricts results to those countries (used to verify activity coordinates).
 */
export async function geocode(query: string, opts: { countryCodes?: string[] } = {}): Promise<Place | null> {
  const q = query.trim();
  if (!q) return null;
  const cacheKey = `${q.toLowerCase()}|${(opts.countryCodes ?? []).join(",")}`;
  const row = db().prepare("SELECT payload FROM geocode_cache WHERE query = ?").get(cacheKey) as
    | { payload: string }
    | undefined;
  if (row) return JSON.parse(row.payload) as Place | null;

  let place: Place | null;
  if (isMockExternal()) {
    place = mockGeocode(q);
  } else {
    const params = new URLSearchParams({
      q,
      format: "jsonv2",
      addressdetails: "1",
      limit: "1",
      "accept-language": "en",
    });
    if (opts.countryCodes?.length) params.set("countrycodes", opts.countryCodes.join(",").toLowerCase());
    const results = await throttled(() =>
      fetchJson<NominatimResult[]>(`https://nominatim.openstreetmap.org/search?${params}`),
    );
    const r = results[0];
    place = r
      ? {
          query: q,
          name: shortName(r),
          lat: Number(r.lat),
          lng: Number(r.lon),
          countryCode: r.address?.country_code?.toUpperCase() ?? null,
        }
      : null;
  }
  db()
    .prepare("INSERT OR REPLACE INTO geocode_cache (query, payload, created_at) VALUES (?, ?, ?)")
    .run(cacheKey, JSON.stringify(place), new Date().toISOString());
  return place;
}
