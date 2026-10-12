import { createProfile, expect, newTrip, test } from "./helpers";

test("compare two destinations, pick one, and move on to interests", async ({ page }) => {
  await createProfile(page);
  await newTrip(page);

  await page.getByLabel("First destination").fill("Lisbon");
  await page.getByLabel("Second destination").fill("Seville");
  await page.getByLabel("Month").selectOption({ label: "May" });
  await page.getByRole("button", { name: "Compare" }).click();
  // Asked about other visas/restrictions before research starts.
  await expect(page.getByRole("heading", { name: /anything else that affects where you can go/ })).toBeVisible();
  await page.getByRole("button", { name: "Looks right — start research" }).click();

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
  await page.getByRole("button", { name: "Looks right — start research" }).click();

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
  await page.getByRole("button", { name: "Looks right — start research" }).click();
  await expect(page.getByText(/Couldn't find "zzz-nowhere"/)).toBeVisible({ timeout: 30_000 });
});

test("asks about other visas and restrictions, and uses them in the research", async ({ page }) => {
  await createProfile(page);
  await newTrip(page);
  await page.getByLabel("First destination").fill("Lisbon");
  await page.getByLabel("Month").selectOption({ label: "May" });
  await page.getByRole("button", { name: "Check fit" }).click();

  const panel = page.getByRole("region", { name: "Visa and travel restrictions check" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Add residence permit").selectOption({ label: "United Kingdom" });
  await panel.getByRole("button", { name: "+ Add a visa you hold" }).click();
  await panel.getByLabel("Visa 1 issuing country").selectOption({ label: "Canada" });
  await panel.getByRole("button", { name: "+ Previous visa refusal or overstay" }).click();
  await panel.getByRole("button", { name: "Looks right — start research" }).click();

  const card = page.getByRole("article", { name: "Fit card for Lisbon, Portugal" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const docs = card.getByRole("list", { name: "Your other documents" });
  await expect(docs.getByText(/Residence permit: United Kingdom/)).toBeVisible();
  await expect(docs.getByText(/tourist visa issued by Canada/)).toBeVisible();
  await expect(card.getByRole("region", { name: "Your restrictions" })).toContainText("Previous visa refusal or overstay");

  // Confirmed once per trip: the summary shows instead of asking again.
  await expect(page.getByTestId("entry-summary")).toContainText("United Kingdom residence permit");
  await page.getByRole("button", { name: "Re-run comparison" }).click();
  await expect(panel).toHaveCount(0);

  // Saved to the profile for next time.
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Remove United Kingdom residence permit" })).toBeVisible();
  await expect(page.getByLabel("Anything else that could affect entry or where you can go?")).toHaveValue(
    "Previous visa refusal or overstay",
  );
});
