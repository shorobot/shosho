import { dismissCookieBanner, expect, test } from "../fixtures";
import { freshPhone, ITEM, openAllDayAndResume } from "../helpers/db";

// Pickup journey: −10% discount, 19% on-site VAT (design/README "VAT 7% delivery / 19% on-site"), and
// completion via the board's "handed_out" action — pickup has no driver account, so whatever the
// operator board does on completion IS the only real-world path (unlike delivery, which can route
// through the driver's own, correct cash_received flow — see checkout-delivery.spec.ts). Everything here
// goes through the real UI/RPC as a guest or a signed-in operator would — no service-role shortcuts for
// the actions under test (only for the opening-hours setup and for reading back what happened).
test.beforeAll(openAllDayAndResume);

test("pickup order: 10% discount, 19% VAT, and what completion actually does to payment_status", async ({ webPage, boPage, db, signInBackoffice }) => {
  const phone = freshPhone();

  await webPage.goto("/");
  await dismissCookieBanner(webPage);
  await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
  await webPage.goto("/checkout");
  await webPage.getByRole("radio", { name: "Pickup" }).click();
  await webPage.getByPlaceholder("Your name").fill("E2E Guest Pickup");
  await webPage.getByPlaceholder("+49 30 000 000").fill(phone);
  await webPage.getByRole("radio", { name: "Cash on delivery" }).click();

  await expect(webPage.getByText(/^−\d/)).toBeVisible(); // the pickup-discount row in Totals (CartLines.tsx)

  const place = webPage.getByRole("complementary", { name: "Order summary" }).getByRole("button", { name: /Place order/ });
  await expect(place).toBeEnabled();
  await place.click();
  await expect(webPage).toHaveURL(/\/order\/[0-9a-f]{32}$/);

  const token = new URL(webPage.url()).pathname.split("/").pop()!;
  const { data: order } = await db
    .from("orders")
    .select("id, number, subtotal_cents, discount_cents, vat_cents, type")
    .eq("tracking_token", token)
    .single();
  expect(order!.type).toBe("pickup");
  expect(order!.discount_cents, "ops.pickup_discount_pct = 10 (api-contracts §1.1)").toBe(Math.round(order!.subtotal_cents * 0.1));

  const { data: item } = await db.from("menu_items").select("vat_onsite_pct").eq("id", ITEM.ramen).single();
  const expectedVatPct = item!.vat_onsite_pct as number; // seed default 19 for on-site/pickup

  await signInBackoffice(boPage, "operator");
  await boPage.goto(`/orders/${order!.id}`);
  await boPage.getByRole("button", { name: /Annehmen/ }).click();
  await boPage.getByRole("button", { name: "Zubereitung starten" }).click();
  await boPage.getByRole("button", { name: "Fertig melden" }).click();
  await expect(boPage.getByText("FERTIG")).toBeVisible();

  await test.step("VAT label: detail shows a fixed 7% regardless of order type (known seam, apps/backoffice/components/detail/OrderDetail.tsx:176)", async () => {
    const vatLine = boPage.getByText(/incl\. \d+% VAT/);
    await expect(vatLine).toBeVisible();
    const text = await vatLine.textContent();
    const shownPct = Number(text?.match(/incl\. (\d+)% VAT/)?.[1]);
    expect(shownPct, `pickup order's VAT was computed at ${expectedVatPct}% (menu_items.vat_onsite_pct) but the label is hardcoded to "7%"`).toBe(expectedVatPct);
  });

  await test.step("handed_out via the board — the only real path for pickup — and what it does to payment_status", async () => {
    await boPage.getByRole("button", { name: "Ausgegeben" }).click();
    await expect(boPage.getByText("ABGEHOLT")).toBeVisible();

    const { data: after } = await db.from("orders").select("payment_status").eq("id", order!.id).single();
    // api-contracts §6.8: cash settles via `set_order_status(..., { cash_received })`. The board's
    // generic "handed_out" action (apps/backoffice/components/orders/OrderCard.tsx: no `dialog` entry
    // for it in lib/orders.ts's actionsFor) sends no payload at all, and `coalesce(cash_received, false)`
    // treats "absent" exactly like "no" (migrations 15/22). There is no counter/driver role for pickup to
    // fall back on the way delivery can — so a real walk-in cash pickup, completed the only way the UI
    // offers, is expected to land here still `pending`, not `paid`.
    expect(
      after!.payment_status,
      "a cash pickup handed out from the board never actually confirms the cash — payment_status should still read pending, not paid; if this now says 'paid' the gap has been fixed upstream",
    ).toBe("pending");
  });
});
