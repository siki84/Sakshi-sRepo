const UA = `Wayfarer-trip-planner/0.1 (${process.env.NOMINATIM_CONTACT || "local development"})`;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, opts: { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(`${new URL(url).host} returned ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

export const isMockExternal = () => process.env.MOCK_EXTERNAL === "1";
