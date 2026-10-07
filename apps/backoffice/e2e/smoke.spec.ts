import { expect, test } from "@playwright/test";

// Seed staff logins (apps/backend/README.md → "Test logins"). [S2-05] seed.sql no longer sets a
// known password; the default below is the local-only value apps/backend/scripts/seed-local-
// logins.mjs sets (local Supabase only). For staging, set E2E_PASSWORD from the credentials file on
// the owner's machine (apps/backend/.staff-credentials.local) — never hardcode a real value here.
const PASSWORD = process.env.E2E_PASSWORD ?? "local-dev-only";

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

/* ── Speisekarte (S4-02) ─────────────────────────────────────────────────────────────────────── */

test("operator reaches the Speisekarte and its filters", async ({ page }) => {
  await signIn(page, "operator@shosho.test");
  await page.getByRole("link", { name: "Speisekarte" }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(page.getByRole("heading", { name: "Speisekarte" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kategorien" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Optionsgruppen" })).toBeVisible();
  // the four filters from the design; "Unvollständig" narrows to flagged rows or an empty state
  for (const f of ["Alle", "Aktiv", "Stoppliste", "Unvollständig"]) {
    await expect(page.getByRole("button", { name: f, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Unvollständig", exact: true }).click();
  await expect(page.locator("table").or(page.getByText("Kategorie ist leer"))).toBeVisible();
});

test("the item editor opens with every section of the design", async ({ page }) => {
  await signIn(page, "operator@shosho.test");
  await page.goto("/menu");
  await page.getByRole("link", { name: /Philadelphia/ }).first().click();
  await expect(page).toHaveURL(/\/menu\/item\//);
  for (const section of ["Basis", "Fotos", "Verkauf", "Küche", "Recht", "Optionen", "Empfohlen dazu", "Vorschau"]) {
    await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Speichern" })).toBeVisible();
  // editing marks the form dirty and the guard asks before leaving
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await expect(page.getByText("NICHT GESPEICHERT")).toBeVisible();
  await page.getByRole("link", { name: /Zurück zur Speisekarte/ }).click();
  await expect(page.getByText("Änderungen verwerfen?")).toBeVisible();
  await page.getByRole("button", { name: "Verwerfen und schließen" }).click();
  await expect(page).toHaveURL(/\/menu$/);
});

test("editing a shared option group warns about the linked items", async ({ page }) => {
  await signIn(page, "operator@shosho.test");
  await page.goto("/menu/options");
  await expect(page.getByRole("heading", { name: "Optionsgruppen" })).toBeVisible();
  const group = page.getByRole("listitem").filter({ hasText: "Sojasauce" });
  await group.getByRole("button", { name: "Bearbeiten" }).click();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gemeinsame Gruppe ändern?")).toBeVisible();
  await expect(page.getByText(/ist mit \d+ Artikeln verknüpft/)).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
});

test("kitchen cannot reach the menu editor", async ({ page }) => {
  await signIn(page, "kitchen@shosho.test");
  await page.goto("/menu");
  await expect(page).toHaveURL(/\/kitchen$/);
  await expect(page.getByRole("link", { name: "Speisekarte" })).toHaveCount(0);
});
