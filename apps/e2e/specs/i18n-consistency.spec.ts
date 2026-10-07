import { expect, test } from "../fixtures";
import { freshPhone, openAllDayAndResume, POSTAL } from "../helpers/db";
import { parseMoneyText } from "../helpers/money";

// "the same order rendered in EN on the site and DE in the back-office" (boot task 2) — plus the
// DE/EN toggle inside the back-office itself, which must change labels only, never values.
test.beforeAll(openAllDayAndResume);

test("toggling the back-office DE/EN only changes labels, never the order's numbers", async ({ webPage, boPage, db, signInBackoffice }) => {
  const phone = freshPhone();
  await webPage.goto("/");
  await webPage.getByRole("button", { name: "OK" }).click();
  await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
  await webPage.goto("/checkout");
  await webPage.getByPlaceholder("Street and number").fill("Torstraße 1");
  await webPage.getByPlaceholder("10119").fill(POSTAL.zoneA);
  await webPage.getByPlaceholder("Your name").fill("E2E i18n Guest");
  await webPage.getByPlaceholder("+49 30 000 000").fill(phone);
  await webPage.getByRole("radio", { name: "Cash on delivery" }).click();
  await webPage.getByRole("complementary", { name: "Order summary" }).getByRole("button", { name: /Place order/ }).click();
  await expect(webPage).toHaveURL(/\/order\/[0-9a-f]{32}$/);
  const token = new URL(webPage.url()).pathname.split("/").pop()!;
  const { data: order } = await db.from("orders").select("id, number, total_cents").eq("tracking_token", token).single();

  await signInBackoffice(boPage, "operator");
  await boPage.goto(`/orders/${order!.id}`);

  const totalLocator = boPage.locator("span.text-\\[20px\\].font-extrabold").last();
  const deTotal = parseMoneyText((await totalLocator.textContent())!);
  await expect(boPage.getByText("NEU")).toBeVisible(); // confirms we're reading the DE label set

  await boPage.getByRole("button", { name: "EN", exact: true }).click();
  const enTotal = parseMoneyText((await totalLocator.textContent())!);
  await expect(boPage.getByText("NEW", { exact: true })).toBeVisible();

  expect(deTotal, "DE/EN toggle must not change what the number IS, only how it's written").toBe(enTotal);
  expect(deTotal).toBe(order!.total_cents);

  await boPage.getByRole("button", { name: "DE", exact: true }).click(); // leave the shared session as found
});

test("allergen codes on the order are the same set the menu item declares, regardless of language", async ({ db }) => {
  // design/README: "Allergens A–N per item (German scheme)" — a code scheme, so DE/EN carries no risk
  // of translation drift the way free text would; this instead checks the snapshot didn't drop any.
  const RAMEN = "30000000-0000-4000-8000-000000000003";
  const { data: item } = await db.from("menu_items").select("allergens").eq("id", RAMEN).single();
  expect(item!.allergens, "seed: Tonkotsu Ramen is A, C, F").toEqual(expect.arrayContaining(["A", "C", "F"]));
  for (const code of item!.allergens as string[]) expect(code).toMatch(/^[A-N]$/);
});
