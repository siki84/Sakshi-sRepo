import { expect, test, tripAtInterests } from "./helpers";

test("pick interests, set the mix, add requirements, and see how they were understood", async ({ page }) => {
  await tripAtInterests(page);
  await expect(page.getByRole("heading", { name: "What are you into in Lisbon?" })).toBeVisible();

  const interests = page.getByRole("region", { name: "Interests" });
  for (const chip of ["Hiking", "Beaches", "Museums & history", "Coffee shops", "Clubbing"]) {
    await interests.getByRole("button", { name: chip, exact: true }).click();
  }
  await expect(page.getByTestId("mix-summary")).toHaveText("Outdoors 40% / City & culture 20% / Food & drink 20% / Nightlife 20%");

  // Custom interest joins its group.
  await page.getByLabel("Custom interest", { exact: true }).fill("Vintage shops");
  await page.getByLabel("Custom interest group").selectOption({ label: "City & culture" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(interests.getByRole("button", { name: "✓ Vintage shops" })).toBeVisible();

  // Sliders stay linked at 100%.
  await page.getByLabel("Outdoors share").fill("50");
  const summary = await page.getByTestId("mix-summary").textContent();
  const total = [...summary!.matchAll(/(\d+)%/g)].reduce((s, m) => s + Number(m[1]), 0);
  expect(total).toBe(100);
  await expect(page.getByTestId("mix-summary")).toContainText("Outdoors 50%");

  // Hard requirements.
  await page.getByRole("button", { name: "+ At least two hikes" }).click();
  await page.getByRole("button", { name: "+ Add another" }).click();
  await page.getByLabel("Requirement 2", { exact: true }).fill("No clubbing");
  await page.getByRole("button", { name: "Save and continue →" }).click();

  const understood = page.getByRole("region", { name: "How we understood you" });
  await expect(understood).toBeVisible();
  await expect(understood).toContainText("At least 2 × hiking");
  await expect(understood).toContainText("No clubbing");
  await expect(understood).toContainText("Removed “Clubbing” because you said: “No clubbing”");
  await expect(interests.getByRole("button", { name: "Clubbing", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("mix-summary")).not.toContainText("Nightlife");

  await understood.getByRole("link", { name: "Continue to discovery →" }).click();
  await expect(page).toHaveURL(/\/discover$/);

  // Everything persisted.
  await page.getByRole("link", { name: /Interests/ }).click();
  await expect(interests.getByRole("button", { name: "✓ Vintage shops" })).toBeVisible();
  await expect(page.getByLabel("Requirement 1", { exact: true })).toHaveValue("At least two hikes");
  await expect(page.getByTestId("mix-summary")).toContainText("Outdoors");
});

test("without requirements, saving goes straight to discovery", async ({ page }) => {
  await tripAtInterests(page);
  await page.getByRole("region", { name: "Interests" }).getByRole("button", { name: "Great dinners", exact: true }).click();
  await expect(page.getByTestId("mix-summary")).toHaveText("Food & drink 100%");
  await expect(page.getByLabel("Food & drink share")).toBeDisabled();
  await page.getByRole("button", { name: "Save and continue →" }).click();
  await expect(page).toHaveURL(/\/discover$/);
});

test("can't continue with only modifiers selected", async ({ page }) => {
  await tripAtInterests(page);
  await page.getByRole("button", { name: "Kid-friendly", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save and continue →" })).toBeDisabled();
});
