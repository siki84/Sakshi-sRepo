import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDbForTests } from "@/lib/db";
import { createTrip, getTrip, getTripByShareId, listTrips, updateTrip, deleteTrip } from "@/lib/repo";
import { cached, cacheKey, cacheGet } from "@/lib/cache";

beforeEach(() => setDbForTests(openDb(":memory:")));

describe("trips repo", () => {
  it("creates, reads, updates, deletes", () => {
    const t = createTrip("Lisbon");
    expect(getTrip(t.id)?.title).toBe("Lisbon");
    expect(getTripByShareId(t.shareId)?.id).toBe(t.id);
    const u = updateTrip(t.id, { phase: 2, state: { stale: ["discover"] } });
    expect(u.phase).toBe(2);
    expect(u.state.stale).toEqual(["discover"]);
    expect(listTrips()).toHaveLength(1);
    deleteTrip(t.id);
    expect(getTrip(t.id)).toBeNull();
  });
});

describe("research cache", () => {
  it("computes once and then serves from cache", async () => {
    let calls = 0;
    const key = cacheKey("fit", { dest: "Lisbon", month: 7 });
    const compute = async () => ({ n: ++calls });
    expect(await cached(key, 1, compute)).toEqual({ n: 1 });
    expect(await cached(key, 1, compute)).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });
  it("treats expired entries as misses", async () => {
    const key = cacheKey("fit", "x");
    await cached(key, -1, async () => 1);
    expect(cacheGet(key)).toBeUndefined();
  });
});
