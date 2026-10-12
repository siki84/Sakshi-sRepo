import { expect, test } from "./helpers";

test("health endpoint reports mock mode and a working DB", async ({ request }) => {
  const res = await request.get("/api/health?ai=1");
  const body = await res.json();
  expect(body.mockAi).toBe(true);
  expect(body.ai).toEqual({ ok: true, reply: "pong" });
});

test("create a trip and land in the wizard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "+ New trip" }).click();
  await expect(page).toHaveURL(/\/trip\/\w+\/destination$/);
  // No profile yet, so the wizard asks for one first.
  await expect(page.getByRole("heading", { name: "First, a quick profile" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Untitled trip").first()).toBeVisible();
});
