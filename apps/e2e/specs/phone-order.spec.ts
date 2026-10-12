import { expect, test } from "../fixtures";
import { openAllDayAndResume } from "../helpers/db";

// api-contracts §6.1: "+ Phone order" → place_order with channel:'phone' from a staff session.
test.beforeAll(openAllDayAndResume);

test("operator creates a phone order and it lands on the board with the phone badge", async ({ boPage, db, signInBackoffice }) => {
  await signInBackoffice(boPage, "operator");
  await expect(boPage).toHaveURL(/\/orders$/);

  await boPage.getByRole("button", { name: "+ Telefonbestellung" }).click();
  await boPage.getByPlaceholder("Artikel suchen…").fill("Ramen");
  await boPage.getByRole("button", { name: "+", exact: true }).first().click(); // qty 1 on the one matching row

  await boPage.getByLabel("Art").selectOption({ label: "Abholung" }); // pickup — no address needed, keeps the test focused
  await boPage.getByLabel("Name", { exact: true }).fill("Phone Order Guest");
  await boPage.getByLabel("Telefon", { exact: true }).fill("+4917000000111");

  const submit = boPage.getByRole("button", { name: "Bestellung anlegen" });
  await expect(submit).toBeEnabled({ timeout: 10_000 }); // debounced quote_order, §6.1
  await submit.click();
  await expect(boPage.getByText(/Bestellung #\d+ angelegt\./)).toBeVisible();

  const { data: orders } = await db
    .from("orders")
    .select("id, number, channel, contact_name")
    .eq("contact_name", "Phone Order Guest")
    .order("created_at", { ascending: false })
    .limit(1);
  expect(orders?.[0]?.channel, "place_order({channel:'phone'}) from a staff session").toBe("phone");

  await boPage.goto("/orders");
  const card = boPage.locator("article", { hasText: `#${orders![0]!.number}` });
  await expect(card.getByText("Telefon")).toBeVisible();
});
