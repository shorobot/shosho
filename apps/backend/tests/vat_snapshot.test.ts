import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anon, ITEM, POSTAL, freshPhone, openAllDay, rpc, signIn, type Db } from "./helpers";

/**
 * [S2-08] D-022 — the VAT rate is snapshotted on the order line at write time.
 *
 * `order_items` already froze `name` / `unit_price_cents` / `line_total_cents` off the menu item
 * because menu values drift. The rate drifted identically and was the one thing not copied: it
 * lived only on `menu_items.vat_delivery_pct` and was read **live**, including by
 * `update_order_items`, which recomputed an existing order's VAT against *today's* rates.
 *
 * The first test below is the one that would have caught that: it changes a menu item's rate
 * between placing an order and editing it, and asserts the edit reproduces the order's own tax.
 * It also asserts the live-join answer *differs*, so a regression cannot pass it by accident.
 *
 * Owner action D9 sets the real 7 / 19 rates with the Steuerberater. Nothing here chooses a rate.
 */

const RATE_ITEM = ITEM.udon; // moved and restored below; vitest runs test files serially

async function place(items: unknown[], overrides: Record<string, unknown> = {}) {
  const { data, error } = await rpc(anon(), "place_order", {
    payload: {
      type: "delivery",
      items,
      contact: { name: "VAT Snapshot", phone: freshPhone() },
      address: { street: "Teststr. 1", postal_code: POSTAL.zoneB, city: "Berlin" },
      payment_method: "card",
      ...overrides,
    },
  });
  if (error) throw new Error(error.message + " " + error.details);
  return data.order_id as string;
}

const orderRow = async (id: string) =>
  (await admin().from("orders")
    .select("vat_cents, subtotal_cents, discount_cents, delivery_fee_cents, delivery_fee_vat_pct")
    .eq("id", id).single()).data!;

const lines = async (id: string) =>
  (await admin().from("order_items").select("name, qty, line_total_cents, vat_pct, item_id")
    .eq("order_id", id).order("created_at")).data!;

const rateOf = async (itemId: string) =>
  Number((await admin().from("menu_items").select("vat_delivery_pct").eq("id", itemId).single()).data!.vat_delivery_pct);

const setRate = (itemId: string, pct: number) =>
  admin().from("menu_items").update({ vat_delivery_pct: pct }).eq("id", itemId);

describe("D-022 VAT rate snapshot on order_items", () => {
  let operator: Db;
  let originalRate: number;

  beforeAll(async () => {
    await openAllDay();
    operator = await signIn("operator");
    originalRate = await rateOf(RATE_ITEM);
  });
  // restore unconditionally: a failing assertion must not leave the menu rate moved for later files
  afterAll(async () => { await setRate(RATE_ITEM, originalRate); });

  it("an edit after the rate changes reproduces the order's OWN tax, not today's", async () => {
    const id = await place([{ item_id: RATE_ITEM, qty: 3 }]);
    const before = await orderRow(id);
    const placedLines = await lines(id);
    expect(placedLines[0].vat_pct).not.toBeNull();
    expect(Number(placedLines[0].vat_pct)).toBe(originalRate);

    // D9 happens: the Steuerberater moves this item to the other rate
    const newRate = originalRate === 19 ? 7 : 19;
    expect((await setRate(RATE_ITEM, newRate)).error).toBeNull();

    // what the old live-join code would now produce for this unchanged order
    const liveJoin = Math.round(
      before.subtotal_cents! * newRate / (100 + newRate)
        * (before.subtotal_cents! - before.discount_cents!) / before.subtotal_cents!
      + before.delivery_fee_cents! * 19 / 119,
    );

    const { data: edited, error } = await rpc(operator, "update_order_items",
      { order_id: id, items: [{ item_id: RATE_ITEM, qty: 3 }] });
    expect(error).toBeNull();

    // the point of this test
    expect(edited.vat_cents).toBe(before.vat_cents);
    expect(Number((await lines(id))[0].vat_pct)).toBe(originalRate);
    // and the test discriminates — a live-join regression would give a different integer
    expect(liveJoin).not.toBe(before.vat_cents);
  });

  it("place_order records the rate it used on every line, and the fee's own rate on the order", async () => {
    const ramenRate = await rateOf(ITEM.ramen);
    const id = await place([{ item_id: ITEM.ramen, qty: 2 }], { tip_cents: 100 });
    const o = await orderRow(id);
    const ls = await lines(id);

    expect(ls.map((l) => Number(l.vat_pct))).toEqual([ramenRate]);
    // the fee rate is written on every order, including fee-free ones, so null means exactly
    // "filed before migration 36"
    expect(Number(o.delivery_fee_vat_pct)).toBe(19);

    // the order's vat_cents is now re-derivable from the snapshot alone — no menu_items read
    const lineVat = ls.reduce((s, l) =>
      s + l.line_total_cents! * Number(l.vat_pct) / (100 + Number(l.vat_pct)), 0);
    const derived = Math.round(
      lineVat * (o.subtotal_cents! - o.discount_cents!) / o.subtotal_cents!
      + o.delivery_fee_cents! * Number(o.delivery_fee_vat_pct) / (100 + Number(o.delivery_fee_vat_pct)),
    );
    expect(derived).toBe(o.vat_cents);
  });

  it("a position added during an edit takes today's rate; the existing position keeps its own", async () => {
    const id = await place([{ item_id: ITEM.ramen, qty: 2 }]);
    const ramenRate = await rateOf(ITEM.ramen);

    const newRate = originalRate === 19 ? 7 : 19;
    expect((await setRate(RATE_ITEM, newRate)).error).toBeNull();

    const { error } = await rpc(operator, "update_order_items", {
      order_id: id,
      items: [{ item_id: ITEM.ramen, qty: 2 }, { item_id: RATE_ITEM, qty: 1 }],
    });
    expect(error).toBeNull();

    const byItem = Object.fromEntries((await lines(id)).map((l) => [l.item_id, Number(l.vat_pct)]));
    expect(byItem[ITEM.ramen]).toBe(ramenRate); // unchanged position: the order's own rate
    expect(byItem[RATE_ITEM]).toBe(newRate);    // new position: no snapshot to inherit, so today's
  });
});
