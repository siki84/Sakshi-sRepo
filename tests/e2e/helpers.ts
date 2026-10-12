import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";

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

/** Fill and save a typical profile through the UI. */
export async function createProfile(page: Page, opts: { humidity?: "Avoid" | "Fine" } = {}) {
  await page.goto("/profile");
  await page.getByLabel("Home city").fill("Chicago, IL");
  await page.getByLabel("Add passport").selectOption({ label: "United States" });
  await page.getByRole("radiogroup", { name: "Humidity" }).getByRole("radio", { name: opts.humidity ?? "Avoid" }).click();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved ✓");
}

export async function newTrip(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "+ New trip" }).click();
  await expect(page).toHaveURL(/\/trip\/\w+\/destination$/);
}
