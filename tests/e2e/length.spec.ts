import { expect, test, tripAtLength, createProfile, newTrip } from "./helpers";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

test("asks roughly how long up front; exact dates imply it", async ({ page }) => {
  await createProfile(page);
  await newTrip(page);
  await expect(page.getByRole("radiogroup", { name: "Approximate trip length" })).toBeVisible();
  await page.getByRole("radio", { name: "About a week" }).click();
  await expect(page.getByLabel("Number of days")).toHaveValue("7");
  await page.getByLabel("Number of days").fill("9");
  await expect(page.getByRole("radio", { name: "About a week" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("radio", { name: "Exact dates" }).click();
  await page.getByLabel("Start date").fill(inDays(30));
  await page.getByLabel("End date").fill(inDays(34));
  await expect(page.getByTestId("date-length")).toHaveText("5 days, from your dates.");
});

test("recommends min / ideal / generous, compares with the rough length, and moves to the plan", async ({ page }) => {
  await tripAtLength(page);
  const headline = page.getByTestId("length-headline");
  await expect(headline).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/You had about 5 days in mind/)).toBeVisible();

  const options = page.getByRole("radiogroup", { name: "Trip length options" });
  await expect(options.getByRole("radio")).toHaveCount(3);
  await expect(options.getByText(/≈ your 5 days/)).toBeVisible();
  await expect(options.getByRole("radio", { name: /^Ideal: \d+ days/ })).toHaveAttribute("aria-checked", "true");

  const generous = options.getByRole("radio", { name: /^Generous: \d+ days/ });
  const gDays = (await generous.getAttribute("aria-label"))!.match(/(\d+) days/)![1];
  await generous.click();
  await expect(page.getByLabel("Number of days")).toHaveValue(gDays);

  // Near-term dates → daily forecast; far dates → typical-weather note + month mismatch warning.
  await page.getByLabel("Start date").fill(inDays(3));
  await expect(page.getByRole("region", { name: "Forecast" }).or(page.getByLabel("Forecast"))).toBeVisible();
  await expect(page.getByText("🌧️").first()).toBeVisible();
  await page.getByLabel("Start date").fill(inDays(60));
  await expect(page.getByText(/Forecasts appear when the trip is within 2 weeks/)).toBeVisible();

  await page.getByLabel("Start date").fill(inDays(3));
  await page.getByRole("button", { name: `Plan my ${gDays} days →` }).click();
  await expect(page).toHaveURL(/\/plan$/);

  // Saved: coming back shows the choice.
  await page.getByRole("link", { name: /How long/ }).click();
  await expect(page.getByLabel("Number of days")).toHaveValue(gDays);
});
