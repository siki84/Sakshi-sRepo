import { beforeEach, describe, expect, it } from "vitest";
import { ProfileSchema, type Profile } from "@/lib/schemas";
import { openDb, setDbForTests } from "@/lib/db";
import { getProfile, saveProfile } from "@/lib/repo";
import { cToF, fToC } from "@/lib/units";
import { COUNTRIES } from "@/lib/countries";

const valid: Profile = {
  homeCity: "Chicago",
  passports: ["US", "IN"],
  weather: { idealMinF: 65, idealMaxF: 80, heat: "dislike", cold: "ok", humidity: "hate", rain: "dislike", notes: "" },
  travelers: { type: "family", kidsAges: [4, 9], groupSize: 4 },
  pace: 3,
  units: "F",
  travelDocs: { residencePermits: [], visasHeld: [], restrictions: "", avoidAdvanceVisa: false },
};

beforeEach(() => setDbForTests(openDb(":memory:")));

describe("ProfileSchema", () => {
  it("accepts a valid profile", () => expect(ProfileSchema.safeParse(valid).success).toBe(true));

  it("requires a home city and a passport", () => {
    const r = ProfileSchema.safeParse({ ...valid, homeCity: "  ", passports: [] });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["homeCity", "passports"]));
  });

  it("rejects an inverted temperature range", () => {
    const r = ProfileSchema.safeParse({ ...valid, weather: { ...valid.weather, idealMinF: 85, idealMaxF: 70 } });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path.join(".")).toBe("weather.idealMaxF");
  });
});

describe("profile repo", () => {
  it("returns null before setup, then round-trips", () => {
    expect(getProfile()).toBeNull();
    saveProfile(valid);
    expect(getProfile()).toEqual(valid);
    saveProfile({ ...valid, pace: 5 });
    expect(getProfile()?.pace).toBe(5);
  });
});

describe("helpers", () => {
  it("converts units", () => {
    expect(fToC(68)).toBe(20);
    expect(cToF(20)).toBe(68);
  });
  it("has a full, named country list", () => {
    expect(COUNTRIES.length).toBeGreaterThan(190);
    expect(COUNTRIES.find((c) => c.code === "PT")?.name).toBe("Portugal");
  });
});
