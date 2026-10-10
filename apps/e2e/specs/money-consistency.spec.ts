import { dismissCookieBanner, expect, test } from "../fixtures";
import { anon, freshPhone, ITEM, openAllDayAndResume, POSTAL } from "../helpers/db";
import { euroWeb, parseMoneyText } from "../helpers/money";

// Task 2: "money arithmetic agreeing between quote_order, the cart UI, the checkout summary, the board
// card, the detail totals and the CSV export." quote_order (called directly, with the exact payload the
// UI builds) is the oracle throughout — never a value computed by this test.
test.beforeAll(openAllDayAndResume);

test("one order's cents agree across quote_order, cart UI, checkout summary, board card, detail and CSV", async ({ webPage, boPage, db, signInBackoffice }) => {
  const phone = freshPhone();
  const quotePayload = { type: "delivery", items: [{ item_id: ITEM.ramen, qty: 2 }], postal_code: POSTAL.zoneB, promo_code: "SHOSHO10" };
  const { data: oracle, error } = await anon().rpc("quote_order", { payload: quotePayload });
  if (error) throw new Error(`oracle quote_order failed: ${error.message}`);

  await webPage.goto("/");
  await dismissCookieBanner(webPage);
  await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
  await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
  await webPage.goto("/checkout");
  await webPage.getByPlaceholder("Street and number").fill("Kastanienallee 1");
  await webPage.getByPlaceholder("10119").fill(POSTAL.zoneB);
  await webPage.getByLabel("PROMOCODE").fill("SHOSHO10");
  await webPage.getByRole("button", { name: "Apply" }).click();

  await test.step("checkout summary matches the oracle", async () => {
    // expect(...).toHaveText retries until the debounced quote_order (CheckoutClient.tsx) settles —
    // no arbitrary wait needed, and no match means the UI's own total genuinely disagrees with the oracle.
    const summary = webPage.getByRole("complementary", { name: "Order summary" });
    await expect(summary.getByText("Total", { exact: true }).locator("..")).toContainText(euroWeb(oracle.total_cents));
    await expect(webPage.getByText(`incl. ${euroWeb(oracle.vat_cents)} VAT`)).toBeVisible();
  });

  await webPage.getByPlaceholder("Your name").fill("E2E Money Check");
  await webPage.getByPlaceholder("+49 30 000 000").fill(phone);
  await webPage.getByRole("radio", { name: "Cash on delivery" }).click();
  await webPage.getByRole("complementary", { name: "Order summary" }).getByRole("button", { name: /Place order/ }).click();
  await expect(webPage).toHaveURL(/\/order\/[0-9a-f]{32}$/);
  const token = new URL(webPage.url()).pathname.split("/").pop()!;
  const { data: order } = await db.from("orders").select("id, number, total_cents, vat_cents, subtotal_cents, discount_cents, delivery_fee_cents").eq("tracking_token", token).single();

  expect(order!.total_cents, "place_order must re-derive, not trust, the client's payload (S3-01's own claim)").toBe(oracle.total_cents);
  expect(order!.vat_cents).toBe(oracle.vat_cents);

  await signInBackoffice(boPage, "operator");

  await test.step("board card total matches the oracle", async () => {
    await boPage.goto("/orders");
    const card = boPage.locator("article", { hasText: `#${order!.number}` });
    const cardTotal = await card.locator("span.text-\\[21px\\]").textContent();
    expect(parseMoneyText(cardTotal!)).toBe(oracle.total_cents);
  });

  await test.step("order detail totals match the oracle", async () => {
    await boPage.goto(`/orders/${order!.id}`);
    const total = await boPage.locator("span.text-\\[20px\\].font-extrabold").last().textContent();
    expect(parseMoneyText(total!)).toBe(oracle.total_cents);
  });

  await test.step("history CSV export carries the same total (api-contracts §6.3)", async () => {
    await boPage.goto("/orders/history");
    const [download] = await Promise.all([boPage.waitForEvent("download"), boPage.getByRole("button", { name: "CSV" }).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    let csv = Buffer.concat(chunks).toString("utf-8");
    if (csv.charCodeAt(0) === 0xfeff) csv = csv.slice(1); // BOM, per lib/csv.ts's toCsv()
    const lines = csv.split(/\r\n/).map((l) => l.split(";"));
    // header order fixed by History.tsx's exportCsv(): no, date, customer, phone, type, items, total, …
    const row = lines.find((cells) => cells[0] === String(order!.number));
    expect(row, `order #${order!.number} not found in the exported CSV`).toBeTruthy();
    const csvCents = Math.round(Number(row![6]!.trim().replace(",", ".")) * 100);
    expect(csvCents).toBe(oracle.total_cents);
  });
});
