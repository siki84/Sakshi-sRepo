import { createProfile, expect, newTrip, test } from "./helpers";

test("compare two destinations, pick one, and move on to interests", async ({ page }) => {
  await createProfile(page);
  await newTrip(page);

  await page.getByLabel("First destination").fill("Lisbon");
  await page.getByLabel("Second destination").fill("Seville");
  await page.getByLabel("Month").selectOption({ label: "May" });
  await page.getByRole("button", { name: "Compare" }).click();

  // Progress is streamed while research runs.
  await expect(page.getByTestId("progress-log")).toContainText(/Searching|🔎|Crunching/);

  const lisbon = page.getByRole("article", { name: "Fit card for Lisbon, Portugal" });
  const seville = page.getByRole("article", { name: "Fit card for Seville, Spain" });
  await expect(lisbon).toBeVisible({ timeout: 30_000 });
  await expect(seville).toBeVisible();
  await expect(page.getByRole("region", { name: "Comparison" })).toBeVisible();

  // Weather numbers, season, visa disclaimer, and sources are all on the card.
  await expect(lisbon.getByText("High / low")).toBeVisible();
  await expect(lisbon.getByText(/Shoulder season/)).toBeVisible();
  await expect(lisbon.getByText(/Visa-free/)).toBeVisible();
  await expect(lisbon.getByText(/always verify with the/)).toBeVisible();
  await expect(lisbon.getByRole("link", { name: "reddit.com" }).first()).toBeVisible();
  // Unsourced claims never reach the UI.
  await expect(page.getByText("Unsourced rumour")).toHaveCount(0);

  await lisbon.getByRole("button", { name: "Choose Lisbon" }).click();
  await page.getByRole("button", { name: "Confirm and pick interests →" }).click();
  await expect(page).toHaveURL(/\/trip\/\w+\/interests$/);

  // Going back shows the saved results and the current choice.
  await page.getByRole("link", { name: /Where/ }).click();
  await expect(page.getByText("Currently planning:")).toBeVisible();
  await expect(page.getByRole("article", { name: "Fit card for Lisbon, Portugal" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(/Lisbon, Portugal · May/)).toBeVisible();
});

test("suggests alternatives when the destination is a poor fit", async ({ page }) => {
  await createProfile(page);
  await newTrip(page);
  await page.getByLabel("First destination").fill("Bangkok");
  await page.getByLabel("Month").selectOption({ label: "July" });
  await page.getByRole("button", { name: "Check fit" }).click();

  const bangkok = page.getByRole("article", { name: "Fit card for Bangkok, Thailand" });
  await expect(bangkok).toBeVisible({ timeout: 30_000 });
  await expect(bangkok.getByText("Poor fit").first()).toBeVisible();
  await expect(bangkok.getByText(/Oppressively humid/)).toBeVisible();

  const alts = page.getByRole("region", { name: "Alternatives" });
  await expect(alts.getByRole("heading", { name: /these might suit you better/ })).toBeVisible({ timeout: 30_000 });
  await expect(alts.getByRole("article")).not.toHaveCount(0);
});

test("shows a helpful error for a place that can't be found", async ({ page }) => {
  await createProfile(page);
  await newTrip(page);
  await page.getByLabel("First destination").fill("zzz-nowhere");
  await page.getByRole("button", { name: "Check fit" }).click();
  await expect(page.getByText(/Couldn't find "zzz-nowhere"/)).toBeVisible({ timeout: 30_000 });
});
