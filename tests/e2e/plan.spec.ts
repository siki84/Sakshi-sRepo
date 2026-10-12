import { expect, test, tripAtPlan } from "./helpers";

test("build two itineraries, choose one, refine (move, chat, drag), and share", async ({ page }, info) => {
  await tripAtPlan(page);
  await page.getByRole("button", { name: "Build my itineraries" }).click();

  const plans = page.getByRole("article", { name: /^Plan: / });
  await expect(plans).toHaveCount(2, { timeout: 30_000 });
  await expect(plans.first().getByText(/requirements/)).toBeVisible();
  await page.getByRole("button", { name: "Choose “Big sights first”" }).click();

  // Chosen plan: days, mix vs asked, where to stay, map tabs.
  const days = page.getByRole("article", { name: /^Day \d+$/ });
  await expect(days).toHaveCount(4);
  await expect(page.getByLabel("Mix achieved vs asked")).toBeVisible();
  await expect(page.getByRole("region", { name: "Where to stay" }).getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Where to stay" }).getByText(/Sources?:/).first()).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Day map" }).getByRole("tab")).toHaveCount(4);
  await expect(days.first().getByText("Arrival day", { exact: true })).toBeVisible();

  // Move via the accessible "Move…" select.
  const day1 = page.getByRole("article", { name: "Day 1" });
  const first = day1.getByRole("listitem").first();
  const name = (await first.getAttribute("aria-label"))!;
  await first.getByRole("combobox", { name: `Move ${name}` }).selectOption({ label: "Day 3" });
  await expect(page.getByRole("article", { name: "Day 3" }).getByRole("listitem", { name, exact: true })).toBeVisible();

  // Chat refinement.
  await page.getByRole("button", { name: "Swap day 2 and 3" }).click();
  await expect(page.getByTestId("chat-log")).toContainText("Swapped day 2 and day 3", { timeout: 30_000 });
  await expect(page.getByRole("article", { name: "Day 2" }).getByRole("listitem", { name, exact: true })).toBeVisible();

  // Drag & drop (desktop pointer).
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1280, height: 4000 }); // keep source and target on screen
    const day4 = page.getByRole("article", { name: "Day 4" });
    const chip = page.getByRole("article", { name: "Day 2" }).getByRole("listitem").first();
    const dragName = (await chip.getAttribute("aria-label"))!;
    const handle = chip.getByRole("button", { name: `Drag ${dragName}` });
    const target = day4.getByLabel("Day 4 Evening");
    const h = (await handle.boundingBox())!;
    const tb = (await target.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 20, h.y + 20, { steps: 5 });
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(day4.getByRole("listitem", { name: dragName, exact: true })).toBeVisible();
  }

  // Share page: read-only, print-friendly.
  const href = await page.getByRole("link", { name: "👁 View shared page" }).getAttribute("href");
  await page.goto(href!);
  await expect(page.getByText("Shared itinerary · read-only")).toBeVisible();
  await expect(page.getByRole("article", { name: /^Day \d+$/ })).toHaveCount(4);
  await expect(page.getByRole("combobox", { name: /^Move / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "🖨 Print / save as PDF" })).toBeVisible();
});

test("the share page explains when there's no plan yet", async ({ page }) => {
  await tripAtPlan(page);
  const res = await page.goto("/share/does-not-exist");
  expect(res?.status()).toBe(404);
});
