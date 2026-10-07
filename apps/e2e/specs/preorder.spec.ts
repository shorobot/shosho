import { expect, test } from "../fixtures";
import { anon, freshPhone, ITEM, openAllDayAndResume } from "../helpers/db";

test.beforeAll(openAllDayAndResume);

test("pre-order for a future slot through the real checkout UI", async ({ webPage, db }) => {
  await webPage.goto("/");
  await webPage.getByRole("button", { name: "OK" }).click();
  await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();
  await webPage.goto("/checkout");
  await webPage.getByRole("radio", { name: "Pickup" }).click();
  await webPage.getByRole("radio", { name: "Pick a time" }).click();

  const input = webPage.locator('input[type="datetime-local"]');
  const min = await input.getAttribute("min");
  await input.fill(min!); // the earliest slot the UI itself offers — always ≥15 min out and inside the
  // all-day opening hours this suite's setup guarantees, regardless of what time this test happens to run

  await expect(webPage.getByText(/Pre-order for/)).toBeVisible();
  await webPage.getByPlaceholder("Your name").fill("E2E Preorder Guest");
  await webPage.getByPlaceholder("+49 30 000 000").fill(freshPhone());
  await webPage.getByRole("radio", { name: "Cash on delivery" }).click();
  await webPage.getByRole("complementary", { name: "Order summary" }).getByRole("button", { name: /Place order/ }).click();
  await expect(webPage).toHaveURL(/\/order\/[0-9a-f]{32}$/);

  const token = new URL(webPage.url()).pathname.split("/").pop()!;
  const { data: order } = await db.from("orders").select("scheduled_for").eq("tracking_token", token).single();
  expect(order!.scheduled_for).toBeTruthy();
});

test("a slot more than ops.preorder_max_days (7) ahead is rejected server-side, UI or not", async () => {
  const farFuture = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const { data, error } = await anon().rpc("quote_order", {
    payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], scheduled_for: farFuture },
  });
  if (error) throw new Error(error.message);
  expect(data.problems.some((p: { code: string; reason?: string }) => p.code === "closed" && p.reason === "slot_too_far"), `expected a closed/slot_too_far problem for a slot 10 days out: ${JSON.stringify(data.problems)}`).toBe(true);
});

test.skip("DST handling across the Europe/Berlin Oct 25 2026 transition — not reachable through a live pre-order in this run", () => {
  // ops.preorder_max_days = 7 in seed; this suite runs weeks before the transition (see the boot's own
  // date), so no pre-order slot offered by the real UI can land on the other side of it. apps/web/lib/
  // hours.ts's berlinToUtc() does a documented two-pass offset specifically for this case — a unit-level
  // exercise of that function (not a live order) around 2026-10-25 02:00/03:00 Europe/Berlin is the
  // honest way to check it, and belongs in apps/web's own vitest suite (outside this boot's boundary:
  // "do NOT modify apps/web"), not here. Filed as a note for whichever session is still active near
  // that date to actually run a live pre-order across it.
});
