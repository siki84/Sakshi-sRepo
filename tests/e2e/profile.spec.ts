import { expect, test } from "./helpers";

test("new trip asks for a profile, then continues into the wizard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "+ New trip" }).click();
  await expect(page.getByRole("heading", { name: "First, a quick profile" })).toBeVisible();
  await page.getByRole("link", { name: "Set up my profile" }).click();

  // Validation: empty submit shows errors.
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Enter your home city")).toBeVisible();
  await expect(page.getByText("Add at least one passport")).toBeVisible();

  await page.getByLabel("Home city").fill("Chicago, IL");
  await page.getByLabel("Add passport").selectOption({ label: "United States" });
  await page.getByLabel("Add passport").selectOption({ label: "India" });
  await page.getByRole("radiogroup", { name: "Humidity" }).getByRole("radio", { name: "Avoid" }).click();
  await page.getByRole("radiogroup", { name: "Who usually travels" }).getByRole("radio", { name: "Family with kids" }).click();
  await page.getByLabel("Kids' ages").fill("4, 9");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page).toHaveURL(/\/trip\/\w+\/destination$/);
  await expect(page.getByRole("heading", { name: "Where are you thinking of going?" })).toBeVisible();
  // Later steps are locked until earlier ones are confirmed.
  await expect(page.getByRole("link", { name: /Plan/ })).toHaveCount(0);

  // Profile persisted and is editable.
  await page.goto("/profile");
  await expect(page.getByLabel("Home city")).toHaveValue("Chicago, IL");
  await expect(page.getByRole("button", { name: "Remove India" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Humidity" }).getByRole("radio", { name: "Avoid" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByLabel("Kids' ages")).toHaveValue("4, 9");

  // Units toggle re-labels the range.
  await page.getByRole("radio", { name: "°C" }).click();
  await expect(page.getByText(/Ideal daytime temperature: 18–27°C/)).toBeVisible();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved ✓");
});
