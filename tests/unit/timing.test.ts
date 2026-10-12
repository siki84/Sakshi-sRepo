import { describe, expect, it } from "vitest";
import { describeTiming, forecastWindow, monthsOf, tripDays, validateTiming } from "@/lib/timing";

const now = new Date("2026-10-12T15:00:00Z");

describe("timing", () => {
  it("lists months a date range touches", () => {
    expect(monthsOf({ kind: "month", month: 7 })).toEqual([7]);
    expect(monthsOf({ kind: "dates", start: "2026-12-28", end: "2027-01-04" })).toEqual([12, 1]);
  });

  it("describes timing", () => {
    expect(describeTiming({ kind: "month", month: 3 })).toBe("March");
    expect(describeTiming({ kind: "dates", start: "2026-11-02", end: "2026-11-06" })).toBe("Nov 2 – Nov 6, 2026");
    expect(tripDays({ kind: "dates", start: "2026-11-02", end: "2026-11-06" })).toBe(5);
  });

  it("uses the forecast only for trips starting within 14 days", () => {
    expect(forecastWindow({ kind: "dates", start: "2026-10-20", end: "2026-10-24" }, now)).toEqual({
      start: "2026-10-20",
      end: "2026-10-24",
    });
    expect(forecastWindow({ kind: "dates", start: "2026-11-20", end: "2026-11-24" }, now)).toBeNull();
    expect(forecastWindow({ kind: "month", month: 10 }, now)).toBeNull();
    // Clipped to the 16-day horizon.
    expect(forecastWindow({ kind: "dates", start: "2026-10-20", end: "2026-11-20" }, now)?.end).toBe("2026-10-27");
  });

  it("validates date ranges", () => {
    expect(validateTiming({ kind: "dates", start: "2026-11-06", end: "2026-11-02" }, now)).toMatch(/End date/);
    expect(validateTiming({ kind: "dates", start: "2025-01-01", end: "2025-01-05" }, now)).toMatch(/past/);
    expect(validateTiming({ kind: "dates", start: "", end: "" }, now)).toMatch(/valid dates/);
    expect(validateTiming({ kind: "dates", start: "2026-11-01", end: "2026-11-05" }, now)).toBeNull();
  });
});
