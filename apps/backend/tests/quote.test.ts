import { beforeAll, describe, expect, it } from "vitest";
import { anon, ITEM, OPT, POSTAL, openAllDay, rpc } from "./helpers";

beforeAll(openAllDay);

describe("quote_order", () => {
  it("pickup happy path: options, −10 % pickup discount, no fee", async () => {
    const { data: q, error } = await rpc(anon(), "quote_order", {
      payload: {
        type: "pickup",
        items: [{ item_id: ITEM.philadelphia, qty: 1, option_ids: [OPT.size16, OPT.soyClassic, OPT.extraWasabi] }],
      },
    });
    expect(error).toBeNull();
    expect(q.ok).toBe(true);
    expect(q.problems).toEqual([]);
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].unit_price_cents).toBe(1490);
    expect(q.lines[0].options_cents).toBe(1400 + 50);
    expect(q.lines[0].line_total_cents).toBe(1490 + 1450);
    expect(q.subtotal_cents).toBe(2940);
    expect(q.pickup_discount_cents).toBe(294);
    expect(q.delivery_fee_cents).toBe(0);
    expect(q.total_cents).toBe(2940 - 294);
    expect(q.zone).toBeNull();
    expect(q.promised_minutes).toBe(22);
  });

  it("delivery: zone by postal code, fee, free delivery over threshold", async () => {
    const base = { type: "delivery", items: [{ item_id: ITEM.ramen, qty: 2 }], postal_code: POSTAL.zoneB };
    const { data: q } = await rpc(anon(), "quote_order", { payload: base });
    expect(q.ok).toBe(true);
    expect(q.zone.code).toBe("B");
    expect(q.subtotal_cents).toBe(2700);
    expect(q.delivery_fee_cents).toBe(290);
    expect(q.total_cents).toBe(2990);
    expect(q.promised_minutes).toBe(60);

    const { data: big } = await rpc(anon(), "quote_order", {
      payload: { ...base, items: [{ item_id: ITEM.ramen, qty: 3 }] },
    });
    expect(big.subtotal_cents).toBe(4050);
    expect(big.delivery_fee_cents).toBe(0); // ≥ 35 € → free
  });

  it("below min order", async () => {
    const { data: q } = await rpc(anon(), "quote_order", {
      payload: { type: "delivery", items: [{ item_id: ITEM.ramen, qty: 1 }], postal_code: POSTAL.zoneC },
    });
    expect(q.ok).toBe(false);
    expect(q.problems).toContainEqual(expect.objectContaining({ code: "below_min_order", min_order_cents: 3000 }));
  });

  it("out of zone", async () => {
    const { data: q } = await rpc(anon(), "quote_order", {
      payload: { type: "delivery", items: [{ item_id: ITEM.ramen, qty: 2 }], postal_code: POSTAL.outside },
    });
    expect(q.ok).toBe(false);
    expect(q.problems).toContainEqual(expect.objectContaining({ code: "out_of_zone" }));
    expect(q.zone).toBeNull();
  });

  it("stoplisted item is unavailable", async () => {
    const { data: q } = await rpc(anon(), "quote_order", {
      payload: { type: "pickup", items: [{ item_id: ITEM.ebiTempura, qty: 1 }] },
    });
    expect(q.ok).toBe(false);
    expect(q.problems).toContainEqual({ code: "unavailable", item_id: ITEM.ebiTempura });
  });

  it("required option group missing → invalid_options", async () => {
    const { data: q } = await rpc(anon(), "quote_order", {
      payload: { type: "pickup", items: [{ item_id: ITEM.philadelphia, qty: 1, option_ids: [OPT.size8] }] },
    });
    expect(q.ok).toBe(false);
    expect(q.problems).toContainEqual(expect.objectContaining({ code: "invalid_options", item_id: ITEM.philadelphia }));
  });

  it("promo SHOSHO10: 10 % of subtotal; unknown code → promo_invalid", async () => {
    const { data: q } = await rpc(anon(), "quote_order", {
      payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 2 }], promo_code: "shosho10" },
    });
    expect(q.ok).toBe(true);
    expect(q.promo.code).toBe("SHOSHO10");
    expect(q.promo_discount_cents).toBe(270);
    expect(q.discount_cents).toBe(270 + 270); // + pickup 10 %

    const { data: bad } = await rpc(anon(), "quote_order", {
      payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 2 }], promo_code: "NOPE" },
    });
    expect(bad.ok).toBe(false);
    expect(bad.problems).toContainEqual(expect.objectContaining({ code: "promo_invalid", reason: "unknown" }));
  });

  it("empty cart", async () => {
    const { data: q } = await rpc(anon(), "quote_order", { payload: { type: "pickup", items: [] } });
    expect(q.ok).toBe(false);
    expect(q.problems).toContainEqual({ code: "empty_cart" });
  });
});
