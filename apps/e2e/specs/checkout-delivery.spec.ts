import { expect, STAFF, test } from "../fixtures";
import { freshPhone, openAllDayAndResume, POSTAL } from "../helpers/db";

// Full delivery journey across all three apps (api-contracts §5.3, §6.1, design/README "Order lifecycle"):
// guest places a delivery order with a promo code → it appears on the operator board → operator drives
// it new → accepted → preparing → ready → out_for_delivery → delivered, cash confirmed → the guest's
// tracking page reflects every step. This is the one test that exercises the whole product, not a layer.
test.beforeAll(openAllDayAndResume);

test("guest delivery order, driven end to end, tracking page follows along", async ({ webPage, boPage, db, signInBackoffice }) => {
  const phone = freshPhone();

  await test.step("guest: add 2× Tonkotsu Ramen, apply SHOSHO10, check out for delivery", async () => {
    await webPage.goto("/");
    await webPage.getByRole("button", { name: "OK" }).click(); // cookie bar (fresh context, always shown)
    await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
    await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click(); // qty 2 via a second add

    await webPage.goto("/checkout");
    await expect(webPage.getByRole("heading", { name: "How would you like it?" })).toBeVisible();
    await webPage.getByPlaceholder("Street and number").fill("Kastanienallee 1");
    await webPage.getByPlaceholder("10119").fill(POSTAL.zoneB);
    await expect(webPage.getByText("Zone B")).toBeVisible();

    await webPage.getByLabel("PROMOCODE").fill("SHOSHO10");
    await webPage.getByRole("button", { name: "Apply" }).click();
    await expect(webPage.getByText("SHOSHO10 ✕")).toBeVisible();

    await webPage.getByPlaceholder("Your name").fill("E2E Guest Delivery");
    await webPage.getByPlaceholder("+49 30 000 000").fill(phone);
    await webPage.getByRole("radio", { name: "Cash on delivery" }).click();

    const place = webPage.getByRole("complementary", { name: "Order summary" }).getByRole("button", { name: /Place order/ });
    await expect(place).toBeEnabled();
    await place.click();
    await expect(webPage).toHaveURL(/\/order\/[0-9a-f]{32}$/);
  });

  const token = new URL(webPage.url()).pathname.split("/").pop()!;
  const { data: order } = await db.from("orders").select("id, number, status, payment_status, total_cents, discount_cents, promo_code").eq("tracking_token", token).single();
  expect(order, "the order the guest just placed must exist by its tracking token").toBeTruthy();
  expect(order!.promo_code, "SHOSHO10 should have been applied server-side").toBe("SHOSHO10");
  expect(order!.discount_cents, "10% of a 27.00 subtotal").toBe(270);
  expect(order!.status, "total < 50€ but payment_method=cash is never auto-accepted (only authorized/paid orders are)").toBe("new");

  await test.step("operator: find it on the board and drive it through", async () => {
    await signInBackoffice(boPage, "operator");
    await expect(boPage).toHaveURL(/\/orders$/);
    await boPage.goto(`/orders/${order!.id}`);
    await expect(boPage.getByRole("heading", { name: `#${order!.number}` })).toBeVisible();

    await boPage.getByRole("button", { name: /Annehmen/ }).click();
    await expect(boPage.getByText("ANGENOMMEN")).toBeVisible();

    await boPage.getByRole("button", { name: "Zubereitung starten" }).click();
    await expect(boPage.getByText("IN ZUBEREITUNG")).toBeVisible();

    await boPage.getByRole("button", { name: "Fertig melden" }).click();
    await expect(boPage.getByText("FERTIG")).toBeVisible();

    await boPage.getByRole("button", { name: "An Fahrer übergeben" }).click();
    await boPage.getByRole("radio", { name: STAFF.driver.name }).click();
    await boPage.getByRole("button", { name: /Übergeben/ }).click();
    await expect(boPage.getByText("UNTERWEGS")).toBeVisible();
  });

  await test.step("guest tracking page reflects acceptance — measuring realtime vs the documented 15s poll fallback", async () => {
    // api-contracts §5.6/§3: the client is documented to SUBSCRIBE to order:<token> broadcasts and treat
    // the 15s poll as a fallback. If that subscription is actually wired, "Order accepted" should appear
    // well under 15s after the operator's click above. Bounded at 6s on purpose — tight enough to fail
    // honestly if the page is poll-only, generous enough not to be a flake on CI.
    await webPage.goto(`/order/${token}`);
    await expect(webPage.getByText("Order accepted")).toBeVisible({ timeout: 6_000 });
  });

  await test.step("driver marks delivered with cash collected; order settles to paid", async () => {
    // Completing via the driver's own account (not the operator board) — this is the path that
    // actually sends { cash_received: true } (apps/backoffice/components/driver/DriverBoard.tsx).
    // See cancellation-refund.spec.ts for the operator-board gap this sidesteps.
    const driverPage = boPage; // reuse the context: sign out, sign back in as the driver
    await driverPage.getByRole("button", { name: "Abmelden" }).click();
    await signInBackoffice(driverPage, "driver");
    await expect(driverPage).toHaveURL(/\/driver$/);
    await driverPage.getByRole("button", { name: /Zugestellt/ }).click();
  });

  await test.step("tracking page reaches the final state", async () => {
    await expect(webPage.getByText("Delivered")).toBeVisible({ timeout: 20_000 });
  });

  const { data: final } = await db.from("orders").select("status, payment_status").eq("id", order!.id).single();
  expect(final!.status).toBe("delivered");
  expect(final!.payment_status, "driver confirmed cash_received:true").toBe("paid");
});
