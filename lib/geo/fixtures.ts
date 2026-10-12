import type { Place } from "../schemas";

/** MOCK_EXTERNAL geocoding fixtures. Unknown names get stable pseudo-coordinates. */
const KNOWN: Record<string, Omit<Place, "query">> = {
  lisbon: { name: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393, countryCode: "PT" },
  porto: { name: "Porto, Portugal", lat: 41.1579, lng: -8.6291, countryCode: "PT" },
  seville: { name: "Seville, Spain", lat: 37.3891, lng: -5.9845, countryCode: "ES" },
  valencia: { name: "Valencia, Spain", lat: 39.4699, lng: -0.3763, countryCode: "ES" },
  "san sebastian": { name: "San Sebastián, Spain", lat: 43.3183, lng: -1.9812, countryCode: "ES" },
  bangkok: { name: "Bangkok, Thailand", lat: 13.7563, lng: 100.5018, countryCode: "TH" },
  "chiang mai": { name: "Chiang Mai, Thailand", lat: 18.7883, lng: 98.9853, countryCode: "TH" },
  "hoi an": { name: "Hoi An, Vietnam", lat: 15.8801, lng: 108.338, countryCode: "VN" },
  bali: { name: "Bali, Indonesia", lat: -8.3405, lng: 115.092, countryCode: "ID" },
  "da nang": { name: "Da Nang, Vietnam", lat: 16.0544, lng: 108.2022, countryCode: "VN" },
  "taipei": { name: "Taipei, Taiwan", lat: 25.033, lng: 121.5654, countryCode: "TW" },
  "kyoto": { name: "Kyoto, Japan", lat: 35.0116, lng: 135.7681, countryCode: "JP" },
  "seattle": { name: "Seattle, United States", lat: 47.6062, lng: -122.3321, countryCode: "US" },
  "chicago": { name: "Chicago, United States", lat: 41.8781, lng: -87.6298, countryCode: "US" },
  "paris": { name: "Paris, France", lat: 48.8566, lng: 2.3522, countryCode: "FR" },
  "madeira": { name: "Madeira, Portugal", lat: 32.7607, lng: -16.9595, countryCode: "PT" },
};

export function mockGeocode(query: string): Place | null {
  const key = query.toLowerCase().split(",")[0].trim();
  if (key.includes("zzz") || key.length < 2) return null; // simulate "not found"
  const hit = KNOWN[key];
  if (hit) return { query, ...hit };
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const title = key.replace(/\b\w/g, (c) => c.toUpperCase());
  return { query, name: title, lat: ((h % 12000) / 100) - 60, lng: (((h >> 8) % 34000) / 100) - 170, countryCode: null };
}

/** Bounded lookups (activity verification): most names "verify" near the center; some don't. */
export function mockGeocodeWithin(query: string, w: { lat: number; lng: number; radiusDeg: number }): Place | null {
  let h = 0;
  for (const c of query.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (h % 6 === 0 || query.toLowerCase().includes("unverifiable")) return null;
  const dLat = (((h % 1000) / 1000) - 0.5) * w.radiusDeg * 0.6;
  const dLng = ((((h >> 10) % 1000) / 1000) - 0.5) * w.radiusDeg * 0.6;
  return { query, name: query.split(",")[0], lat: w.lat + dLat, lng: w.lng + dLng, countryCode: null };
}
