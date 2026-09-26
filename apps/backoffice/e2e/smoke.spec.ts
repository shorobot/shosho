import { expect, test } from "@playwright/test";

// Seed staff logins (apps/backend/README.md → "Test logins"). Override with E2E_PASSWORD when the
// staging password has been rotated.
const PASSWORD = process.env.E2E_PASSWORD ?? "shosho-test-2026";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
}

test("operator signs in and the board renders", async ({ page }) => {
  await signIn(page, "operator@shosho.test");
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole("heading", { name: "Bestellungen" })).toBeVisible();
  // KPI strip + the four filter chips are always there, with or without orders
  await expect(page.getByText("BESTELLUNGEN", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lieferung" })).toBeVisible();
  // either order cards or one of the documented empty states (a fresh seed has no orders today)
  const cards = page.locator("article");
  const emptyState = page.getByText("Noch keine Bestellungen heute");
  await expect(cards.first().or(emptyState)).toBeVisible();
});

test("DE/EN toggle switches the shell", async ({ page }) => {
  await signIn(page, "operator@shosho.test");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await page.getByRole("button", { name: "DE", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bestellungen" })).toBeVisible();
});

test("kitchen lands on the kitchen board, driver on their deliveries", async ({ page }) => {
  await signIn(page, "kitchen@shosho.test");
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(page.getByRole("heading", { name: "Küche" })).toBeVisible();
  await page.getByRole("button", { name: "Abmelden" }).click();

  await signIn(page, "driver@shosho.test");
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByRole("heading", { name: "Meine Lieferungen" })).toBeVisible();
});

test("unauthenticated visitors are redirected to /login", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/login/);
});
