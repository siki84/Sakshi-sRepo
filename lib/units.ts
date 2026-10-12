export const fToC = (f: number) => Math.round(((f - 32) * 5) / 9);
export const cToF = (c: number) => Math.round((c * 9) / 5 + 32);

export function formatTemp(f: number, units: "F" | "C"): string {
  return units === "C" ? `${fToC(f)}°C` : `${Math.round(f)}°F`;
}
