import { describe, expect, it } from "vitest";
import { aggregateDaily, type DailySeries } from "@/lib/weather/openMeteo";
import { scoreWeather } from "@/lib/weather/score";
import type { Climate, WeatherPrefs } from "@/lib/schemas";

const prefs: WeatherPrefs = {
  idealMinF: 65,
  idealMaxF: 80,
  heat: "dislike",
  cold: "ok",
  humidity: "hate",
  rain: "dislike",
  notes: "",
};

const climate = (c: Partial<Climate>): Climate => ({
  source: "normals",
  basis: "test",
  avgHighF: 75,
  avgLowF: 60,
  rainyDaysPerMonth: 3,
  precipMmPerMonth: 20,
  dewPointF: 50,
  humidityPct: 55,
  daylightHours: 14,
  sunshineHours: 10,
  ...c,
});

describe("scoreWeather", () => {
  it("scores an in-range, dry month as a great fit", () => {
    const r = scoreWeather(climate({}), prefs);
    expect(r.score).toBe(100);
    expect(r.label).toBe("great");
    expect(r.reasons[0]).toEqual({ tone: "good", text: "Highs around 75°F — right in your 65°F–80°F range" });
  });

  it("scores a hot, muggy, rainy month as poor and explains why", () => {
    const r = scoreWeather(climate({ avgHighF: 91, dewPointF: 75, rainyDaysPerMonth: 19 }), prefs);
    expect(r.label).toBe("poor");
    const bad = r.reasons.filter((x) => x.tone === "bad").map((x) => x.text);
    expect(bad.join(" | ")).toMatch(/above your .* range \(you dislike that\)/);
    expect(bad.join(" | ")).toMatch(/Oppressively humid .* you want to avoid that/);
    expect(bad.join(" | ")).toMatch(/Rain on about 19 days/);
  });

  it("does not penalize heat for someone who loves it", () => {
    const r = scoreWeather(climate({ avgHighF: 92 }), { ...prefs, heat: "love" });
    expect(r.score).toBe(100);
  });

  it("falls back to relative humidity when dew point is missing", () => {
    const r = scoreWeather(climate({ dewPointF: null, humidityPct: 90 }), prefs);
    expect(r.score).toBeLessThan(100);
  });

  it("formats in Celsius when asked", () => {
    expect(scoreWeather(climate({}), prefs, "C").reasons[0].text).toContain("24°C");
  });
});

describe("aggregateDaily", () => {
  const daily: DailySeries = {
    time: ["2024-07-01", "2024-07-02", "2024-08-01", "2025-07-01"],
    temperature_2m_max: [80, 90, 100, 70],
    temperature_2m_min: [60, 70, 80, 50],
    precipitation_sum: [0, 5, 10, 0.5],
    dew_point_2m_mean: [50, 60, 70, null],
    relative_humidity_2m_mean: [40, 60, 80, 50],
    daylight_duration: [3600 * 14, 3600 * 14, 3600 * 13, 3600 * 14],
    sunshine_duration: [3600 * 10, 3600 * 8, 3600 * 8, 3600 * 12],
  };

  it("averages only the requested months and ignores nulls", () => {
    const a = aggregateDaily(daily, [7]);
    expect(a.avgHighF).toBe(80);
    expect(a.avgLowF).toBe(60);
    expect(a.rainyDaysPerMonth).toBe(10); // 1 of 3 days ≥1 mm → 10/30
    expect(a.dewPointF).toBe(55);
    expect(a.humidityPct).toBe(50);
    expect(a.daylightHours).toBe(14);
  });

  it("returns null humidity when the API omitted it", () => {
    const rest: DailySeries = { ...daily };
    delete rest.dew_point_2m_mean;
    delete rest.relative_humidity_2m_mean;
    const a = aggregateDaily(rest, [7]);
    expect(a.dewPointF).toBeNull();
    expect(a.humidityPct).toBeNull();
  });

  it("throws when no days match", () => {
    expect(() => aggregateDaily(daily, [1])).toThrow();
  });
});
