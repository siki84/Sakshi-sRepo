import type { Fixture } from "./index";

const KIND: Record<string, string> = {
  arrival: "Arrive & settle in",
  departure: "Last wander & depart",
  travel: "Travel day",
  daytrip: "Day trip",
  full: "Explore",
  free: "Free day",
};

export function planNarrativeFixture(input: unknown): Fixture {
  const { variants } = input as { variants: { key: string; days: { n: number; area: string; kind: string }[] }[] };
  return {
    queries: [],
    searchResults: [],
    data: {
      variants: variants.map((v) => ({
        key: v.key,
        tagline: v.key === "frontload" ? "[Sample] Big sights early, slower finish." : "[Sample] A bit of everything each day, at an easy pace.",
        days: v.days.map((d) => ({ n: d.n, title: `${KIND[d.kind] ?? "Explore"}: ${d.area}`, summary: `[Sample] A ${d.kind} day around ${d.area}.` })),
      })),
    },
  };
}

export function planStaysFixture(input: unknown): Fixture {
  const { city, center, want, areas } = input as { city: string; center: { lat: number; lng: number }; want: number; areas: string[] };
  const c = city.split(",")[0].toLowerCase();
  const urls = [`https://www.reddit.com/r/${c}/comments/where_to_stay`, `https://example-blog.com/${c}/neighborhoods`];
  return {
    queries: [`best neighborhood to stay in ${city} reddit`],
    searchResults: urls.map((url) => ({ url, title: `Where to stay in ${city}` })),
    data: {
      stays: Array.from({ length: want }, (_, i) => ({
        name: i === 0 ? (areas[0] ?? `Central ${city.split(",")[0]}`) : (areas[1] ?? `Near ${areas[0] ?? city.split(",")[0]}`),
        why: `[Sample] Close to your days in ${areas.slice(0, 2).join(" and ")}.`,
        walkability: "[Sample] Very walkable, some hills.",
        transit: "[Sample] Metro and trams nearby.",
        noise: i === 0 ? "[Sample] Lively at night on weekends." : "[Sample] Quiet residential streets.",
        priceFeel: i === 0 ? "$$$" : "$$",
        bestFor: "[Sample] First-timers who want to walk everywhere.",
        lat: center.lat + i * 0.004,
        lng: center.lng - i * 0.004,
        sourceUrls: [urls[i % 2]],
      })),
    },
  };
}

/** Keyword stand-in for chat refinement. */
export function planRefineFixture(input: unknown): Fixture {
  const { message, days, candidates } = input as {
    message: string;
    days: { n: number; ids: string[] }[];
    candidates: { id: string; category: string; name: string }[];
  };
  const m = message.toLowerCase();
  const ops: unknown[] = [];
  let reply = "[Sample] I couldn't map that to a change — try “swap day 2 and 3”, “make day 2 lighter”, or “add a coffee stop”.";
  const swap = m.match(/swap day (\d+) (?:and|with) (?:day )?(\d+)/);
  const lighter = m.match(/day (\d+) lighter|lighten day (\d+)/);
  if (swap) {
    ops.push({ op: "swap_days", activityId: null, day: Number(swap[1]), toDay: Number(swap[2]), block: null });
    reply = `[Sample] Swapped day ${swap[1]} and day ${swap[2]}.`;
  } else if (lighter) {
    const n = Number(lighter[1] ?? lighter[2]);
    ops.push({ op: "lighten_day", activityId: null, day: n, toDay: null, block: null });
    reply = `[Sample] Made day ${n} lighter.`;
  } else if (/add .*coffee/.test(m)) {
    const c = candidates.find((x) => x.category === "coffee");
    const target = [...days].sort((a, b) => a.ids.length - b.ids.length)[0];
    if (c) {
      ops.push({ op: "add", activityId: c.id, day: null, toDay: target.n, block: "morning" });
      reply = `[Sample] Added ${c.name} to day ${target.n}.`;
    } else reply = "[Sample] There aren't any coffee spots in your list yet — try “More like this” on Discover.";
  }
  return { queries: [], searchResults: [], data: { reply, ops, dayTitles: [] } };
}
