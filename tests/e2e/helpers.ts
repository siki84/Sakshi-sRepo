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

/** Profile + new trip + confirmed Lisbon in May → lands on the interests step. */
export async function tripAtInterests(page: Page) {
  await createProfile(page);
  await newTrip(page);
  await page.getByLabel("First destination").fill("Lisbon");
  await page.getByLabel("Month").selectOption({ label: "May" });
  await page.getByRole("radio", { name: "4–5 days" }).click();
  await page.getByRole("button", { name: "Check fit" }).click();
  await page.getByRole("button", { name: "Looks right — start research" }).click();
  await page.getByRole("button", { name: "Choose Lisbon" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Confirm and pick interests →" }).click();
  await expect(page).toHaveURL(/\/interests$/);
}

/** …then picks interests and lands on discovery. */
export async function tripAtDiscover(page: Page) {
  await tripAtInterests(page);
  const interests = page.getByRole("region", { name: "Interests" });
  for (const chip of ["Hiking", "Museums & history", "Coffee shops"]) {
    await interests.getByRole("button", { name: chip, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save and continue →" }).click();
  await expect(page).toHaveURL(/\/discover$/);
}

/** …then researches, keeps a few, and lands on trip length. */
export async function tripAtLength(page: Page) {
  await tripAtDiscover(page);
  await page.getByRole("button", { name: "Find things to do" }).click();
  await expect(page.getByRole("heading", { name: /\d+ ideas/ })).toBeVisible({ timeout: 30_000 });
  const cards = page.getByRole("list", { name: "Activity list" }).getByRole("article");
  for (let i = 0; i < 6; i++) {
    const name = (await cards.nth(i).getByRole("heading").textContent())!;
    await cards.nth(i).getByRole("button", { name: `Keep ${name}` }).click();
  }
  await page.getByRole("button", { name: "Continue to trip length →" }).click();
  await expect(page).toHaveURL(/\/length$/);
}

/** …then accepts the ideal length and lands on the plan step. */
export async function tripAtPlan(page: Page) {
  await tripAtLength(page);
  await expect(page.getByTestId("length-headline")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Number of days").fill("4");
  await page.getByRole("button", { name: "Plan my 4 days →" }).click();
  await expect(page).toHaveURL(/\/plan$/);
}
