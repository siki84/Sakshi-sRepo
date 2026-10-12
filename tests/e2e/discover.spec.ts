import { expect, test, tripAtDiscover } from "./helpers";

test("research, keep/remove, more like this, and continue", async ({ page }, info) => {
  await tripAtDiscover(page);
  await expect(page.getByRole("heading", { name: /What's actually worth doing in Lisbon/ })).toBeVisible();
  await page.getByRole("button", { name: "Find things to do" }).click();
  await expect(page.getByTestId("progress-log")).toContainText(/Researching|🔎/);

  const heading = page.getByRole("heading", { name: /\d+ ideas · 0 kept/ });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  const list = page.getByRole("list", { name: "Activity list" });
  const cards = list.getByRole("article");
  expect(await cards.count()).toBeGreaterThan(15);

  // Cards carry the required fields.
  const first = cards.first();
  await expect(first.getByText(/Must-see|Local gem/)).toBeVisible();
  await expect(first.getByText(/⏱/)).toBeVisible();
  await expect(first.getByText(/Sources?:/)).toBeVisible();
  await expect(list.getByText("Location approximate").first()).toBeVisible();
  await expect(page.getByText(/rumor spot/)).toHaveCount(0); // unsourced items never show

  // Keep the first, remove the second, then restore it.
  const firstName = (await first.getByRole("heading").textContent())!;
  await first.getByRole("button", { name: `Keep ${firstName}` }).click();
  await expect(page.getByRole("heading", { name: /· 1 kept/ })).toBeVisible();
  const second = cards.nth(1);
  const secondName = (await second.getByRole("heading").textContent())!;
  await second.getByRole("button", { name: `Remove ${secondName}` }).click();
  await expect(list.getByRole("article", { name: secondName, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show removed (1)" }).click();
  await page.getByRole("button", { name: "↩ Restore" }).click();
  await expect(page.getByRole("button", { name: /Show removed/ })).toHaveCount(0);

  // Filters.
  await page.getByRole("radio", { name: "💎 Local gems" }).click();
  const gems = await cards.count();
  expect(gems).toBeGreaterThan(0);
  await expect(cards.getByText("⭐ Must-see")).toHaveCount(0);
  await page.getByRole("radio", { name: "All", exact: true }).click();

  // More like this.
  await page.getByRole("button", { name: `More like ${firstName}` }).click();
  await expect(list.getByRole("article", { name: new RegExp(`^Like ${firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} #`) }).first()).toBeVisible({
    timeout: 30_000,
  });

  // Mobile has a List/Map toggle; desktop shows both.
  if (info.project.name === "mobile") {
    await page.getByRole("radio", { name: "Map" }).click();
    await expect(page.getByTestId("map")).toBeVisible();
    await page.getByRole("radio", { name: "List" }).click();
  } else {
    await expect(page.getByTestId("map")).toBeVisible();
  }

  // Choices persist.
  await page.reload();
  await expect(page.getByRole("heading", { name: /· 1 kept/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue to trip length →" }).click();
  await expect(page).toHaveURL(/\/length$/);
});

test("changing interests offers to research just what's new", async ({ page }) => {
  await tripAtDiscover(page);
  await page.getByRole("button", { name: "Find things to do" }).click();
  await expect(page.getByRole("heading", { name: /\d+ ideas/ })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: /Interests/ }).click();
  await page.getByRole("region", { name: "Interests" }).getByRole("button", { name: "Bars", exact: true }).click();
  await page.getByRole("button", { name: "Save and continue →" }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByText("Your interests changed since this list was researched.")).toBeVisible();
  await page.getByRole("button", { name: "Research new interests" }).click();
  await expect(page.getByText("Your interests changed since this list was researched.")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("combobox", { name: "Interest filter" }).selectOption({ label: "🌙 Nightlife" });
  await expect(page.getByRole("list", { name: "Activity list" }).getByRole("article").first()).toBeVisible();
});
