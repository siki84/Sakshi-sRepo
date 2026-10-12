import { test as base, expect, type APIRequestContext } from "@playwright/test";

export async function resetData(request: APIRequestContext) {
  const res = await request.post("/api/test/reset");
  if (!res.ok()) throw new Error(`reset failed: ${res.status()}`);
}

/** `test` that starts from empty data and fails on any uncaught page error (e.g. hydration). */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page, request }, use) => {
      await resetData(request);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "uncaught page errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
