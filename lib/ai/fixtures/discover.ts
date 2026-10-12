import type { RequirementRule } from "../../schemas";
import type { Fixture } from "./index";

/** MOCK_AI: deterministic activities around the batch's city center. */

const human = (k: string) => k.replace(/^custom_/, "").replace(/_/g, " ");

function jitter(seed: string, i: number) {
  let h = 2166136261;
  for (const c of `${seed}#${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return { dLat: ((h % 1000) / 1000 - 0.5) * 0.08, dLng: (((h >> 10) % 1000) / 1000 - 0.5) * 0.08 };
}

type Batch = { key: string; kind: string; city: string; chips: string[]; count: number };

export function discoverBatchFixture(input: unknown): Fixture {
  const { batch, center, allowed, rules } = input as {
    batch: Batch;
    center: { lat: number; lng: number };
    allowed: string[];
    rules: RequirementRule[];
  };
  const cats = (batch.chips.length ? batch.chips : allowed).filter((c) => allowed.includes(c));
  const city = batch.city.split(",")[0];
  const searchResults: Fixture["searchResults"] = [];
  const activities = Array.from({ length: batch.count }, (_, i) => {
    const category = cats[i % cats.length] ?? allowed[0];
    const url = `https://www.reddit.com/r/${city.toLowerCase()}/comments/${batch.key.replace(/\W/g, "")}${i}`;
    searchResults.push({ url, title: `Best ${human(category)} in ${city}? : r/${city.toLowerCase()}` });
    const { dLat, dLng } = jitter(batch.key + batch.city, i);
    const mustSee = batch.kind === "must_see" ? i < batch.count - 2 : i % 3 === 0;
    return {
      name: `${city} ${human(category)} ${mustSee ? "landmark" : "gem"} ${batch.key === "must_see" ? "M" : batch.key.slice(0, 2).toUpperCase()}${i + 1}`,
      category,
      tag: mustSee ? "must_see" : "local_gem",
      why: `[Sample data] A ${mustSee ? "classic" : "local favorite"} for ${human(category)}.`,
      area: ["Old Town", "Riverside", "Hilltop", "Market District"][i % 4],
      durationHrs: [1, 1.5, 2, 3][i % 4],
      bestTime: (["morning", "afternoon", "evening", "any"] as const)[i % 4],
      setting: i % 2 ? "outdoor" : "indoor",
      kidFriendly: i % 3 !== 1,
      buzz: 5 - (i % 5),
      lat: center.lat + dLat,
      lng: center.lng + dLng,
      sourceUrls: [url],
    };
  });
  // One unsourced item (must be dropped) and one the geocoder can't confirm.
  activities.push({ ...activities[0], name: `${city} rumor spot`, sourceUrls: ["https://made-up.example/x"] });
  activities[activities.length - 2] = { ...activities[activities.length - 2], name: `Unverifiable alley ${batch.key}` };
  if (batch.kind === "must_see") {
    for (const r of rules.filter((r) => r.kind === "must_include" && r.place)) {
      activities.unshift({ ...activities[0], name: r.place!, tag: "must_see", buzz: 5 });
    }
  }
  return { data: { activities }, queries: [`site:reddit.com ${city} ${batch.chips.slice(0, 2).map(human).join(" ")}`], searchResults };
}

export function discoverMoreFixture(input: unknown): Fixture {
  const { seed, center } = input as { seed: { name: string; category: string; city: string }; center: { lat: number; lng: number } };
  const city = seed.city.split(",")[0];
  const searchResults: Fixture["searchResults"] = [];
  const activities = Array.from({ length: 4 }, (_, i) => {
    const url = `https://example-blog.com/${city.toLowerCase()}/like-${i}`;
    searchResults.push({ url, title: `More like ${seed.name}` });
    const { dLat, dLng } = jitter(seed.name, i);
    return {
      name: `Like ${seed.name} #${i + 1}`,
      category: seed.category,
      tag: "local_gem",
      why: `[Sample data] Same appeal as ${seed.name}.`,
      area: "Riverside",
      durationHrs: 1.5,
      bestTime: "afternoon",
      setting: "mixed",
      kidFriendly: true,
      buzz: 3,
      lat: center.lat + dLat,
      lng: center.lng + dLng,
      sourceUrls: [url],
    };
  });
  return { data: { activities }, queries: [`${city} places like ${seed.name}`], searchResults };
}
