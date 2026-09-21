// Smoke e2e with the mock API (NEXT_PUBLIC_API=mock): menu → product → cart → checkout → tracking,
// desktop and 375 px. Run: pnpm --filter @shosho/web exec playwright install chromium && pnpm --filter @shosho/web test:e2e
import { expect, test } from "@playwright/test";

test("guest can order from the menu to the tracking page", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile";
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Popular right now" })).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click(); // cookie bar

  await page.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
  await page.getByRole("link", { name: "Philadelphia Deluxe" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Philadelphia Deluxe" })).toBeVisible();
  await page.getByRole("radio", { name: /24 pcs/ }).click();
  await page.getByRole("button", { name: /Add to order/ }).click();

  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "How would you like it?" })).toBeVisible();
  await page.getByPlaceholder("Street and number").fill("Torstraße 128");
  await page.getByPlaceholder("10119").fill("10119");
  await expect(page.getByText("Zone A")).toBeVisible();
  const slots = page.getByRole("radio", { name: /^(Tomorrow )?\d\d:\d\d$/ });
  await slots.first().click();
  await page.getByPlaceholder("Your name").fill("Anna Weber");
  await page.getByPlaceholder("+49 30 000 000").fill("0176 123 45 67");
  await page.getByRole("radio", { name: "Cash on delivery" }).click();

  const place = isMobile ? page.locator(".fixed").getByRole("button", { name: /Place order/ }) : page.getByRole("complementary", { name: "Order summary" }).getByRole("button", { name: /Place order/ });
  await expect(place).toBeEnabled();
  await place.click();

  await expect(page).toHaveURL(/\/order\/[0-9a-f]{32}$/);
  await expect(page.getByRole("heading", { name: /Order #\d+/ })).toBeVisible();
  await expect(page.getByText("Order received")).toBeVisible();
});

test("empty states name the reason", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page.getByText("Your basket is empty")).toBeVisible();
  await page.goto("/order/not-a-token");
  await expect(page.getByText("We can't find this order")).toBeVisible();
  await page.goto("/?q=zzzz");
  await expect(page.getByText(/Nothing found for/)).toBeVisible();
});
