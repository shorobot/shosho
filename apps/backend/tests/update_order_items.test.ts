import { beforeAll, describe, expect, it } from "vitest";
import * as fx from "./fixtures/stripe/events";
import { toRecordPaymentEventArgs } from "../supabase/functions/_shared/stripe-mapping";
import { admin, anon, ITEM, OPT, openAllDay, ramenOrder, rpc, signIn, type Db } from "./helpers";

beforeAll(openAllDay);

async function order(overrides: Record<string, unknown> = {}) {
  const { data, error } = await rpc(anon(), "place_order", { payload: ramenOrder(overrides) });
  if (error) throw new Error(error.message + " " + error.details);
  return { id: data.order_id as string, total: data.total_cents as number };
}
const edit = (c: Db, order_id: string, items: unknown) => rpc(c, "update_order_items", { order_id, items });

describe("update_order_items", () => {
  let operator: Db, kitchen: Db;
  beforeAll(async () => {
    [operator, kitchen] = await Promise.all([signIn("operator"), signIn("kitchen")]);
  });

  it("re-quotes, replaces positions, marks changed rows, writes item_changed with the diff", async () => {
    const o = await order({ tip_cents: 100 }); // 2 × ramen 13.50 + fee 2.90 + tip 1.00 = 30.90 (zone B)
    expect(o.total).toBe(3090);
    const { data: r, error } = await edit(operator, o.id, [
      { item_id: ITEM.ramen, qty: 2 },                                       // unchanged
      { item_id: ITEM.philadelphia, qty: 1, option_ids: [OPT.size8, OPT.soyClassic] }, // added
    ]);
    expect(error).toBeNull();
    expect(r.subtotal_cents).toBe(2700 + 1490);
    expect(r.delivery_fee_cents).toBe(0); // 41.90 ≥ 35 € free delivery
    expect(r.tip_cents).toBe(100);
    expect(r.total_cents).toBe(4190 + 100);
    expect(r.items.map((i: any) => [i.name, i.qty, i.modified])).toEqual([["Tonkotsu Ramen", 2, false], ["Philadelphia Roll", 1, true]]);

    const a = admin();
    const { data: rows } = await a.from("order_items").select("name, qty, modified_by_operator, line_total_cents").eq("order_id", o.id).order("created_at");
    expect(rows).toEqual([
      { name: "Tonkotsu Ramen", qty: 2, modified_by_operator: false, line_total_cents: 2700 },
      { name: "Philadelphia Roll", qty: 1, modified_by_operator: true, line_total_cents: 1490 },
    ]);
    const { data: ev } = await a.from("order_events").select("type, actor_type, actor_id, payload").eq("order_id", o.id).eq("type", "item_changed");
    expect(ev).toHaveLength(1);
    expect(ev![0].actor_type).toBe("staff");
    expect(ev![0].payload.before).toHaveLength(1);
    expect(ev![0].payload.after).toHaveLength(2);
    expect(ev![0].payload.totals).toMatchObject({ subtotal_cents_before: 2700, subtotal_cents: 4190, total_cents: 4290 });

    // reduce qty → row is "modified"
    const { data: r2 } = await edit(operator, o.id, [{ item_id: ITEM.ramen, qty: 1 }]);
    expect(r2.subtotal_cents).toBe(1350);
    expect(r2.delivery_fee_cents).toBe(290);
    expect(r2.items[0].modified).toBe(true);
    // guest sees the new positions
    const { data: t } = await rpc(anon(), "get_order_by_token", { token: (await a.from("orders").select("tracking_token").eq("id", o.id).single()).data!.tracking_token });
    expect(t.items).toHaveLength(1);
    expect(t.total_cents).toBe(1350 + 290 + 100);
  });

  it("rejects bad items, empty lists, wrong status and wrong role", async () => {
    const o = await order();
    const { error: bad } = await edit(operator, o.id, [{ item_id: ITEM.ebiTempura, qty: 1 }]); // stoplisted
    expect(bad!.message).toBe("order_rejected");
    expect(JSON.parse(bad!.details)[0]).toMatchObject({ code: "unavailable" });
    const { error: opts } = await edit(operator, o.id, [{ item_id: ITEM.philadelphia, qty: 1 }]); // required groups missing
    expect(opts!.message).toBe("order_rejected");
    expect(JSON.parse(opts!.details)[0].code).toBe("invalid_options");
    const { error: empty } = await edit(operator, o.id, []);
    expect(empty!.message).toBe("order_rejected");
    const { error: role } = await edit(kitchen, o.id, [{ item_id: ITEM.ramen, qty: 1 }]);
    expect(role!.message).toBe("forbidden_for_role");
    const { error: anonErr } = await edit(anon(), o.id, [{ item_id: ITEM.ramen, qty: 1 }]);
    expect(anonErr).not.toBeNull();

    await rpc(operator, "set_order_status", { order_id: o.id, new_status: "accepted" });
    await rpc(operator, "set_order_status", { order_id: o.id, new_status: "preparing" });
    const { error: okPrep } = await edit(operator, o.id, [{ item_id: ITEM.ramen, qty: 3 }]);
    expect(okPrep).toBeNull();
    await rpc(operator, "set_order_status", { order_id: o.id, new_status: "ready" });
    const { error: late } = await edit(operator, o.id, [{ item_id: ITEM.ramen, qty: 1 }]);
    expect(late!.message).toBe("order_not_editable");
  });

  it("keeps a promo that was valid at checkout; drops it when the cart no longer qualifies", async () => {
    const o = await order({ promo_code: "SHOSHO10", items: [{ item_id: ITEM.ramen, qty: 2 }] }); // −10 % on 27.00
    const a = admin();
    const { data: before } = await a.from("orders").select("discount_cents, promo_code").eq("id", o.id).single();
    expect(before).toEqual({ discount_cents: 270, promo_code: "SHOSHO10" });
    const { data: r } = await edit(operator, o.id, [{ item_id: ITEM.ramen, qty: 3 }]);
    expect(r.promo_code).toBe("SHOSHO10");
    expect(r.discount_cents).toBe(405);
    // below the promo's 20 € minimum → promo dropped
    const { data: r2 } = await edit(operator, o.id, [{ item_id: ITEM.miso, qty: 1 }]);
    expect(r2.promo_code).toBeNull();
    expect(r2.discount_cents).toBe(0);
    const { data: ev } = await a.from("order_events").select("payload").eq("order_id", o.id).eq("type", "item_changed").order("at");
    expect(ev![1].payload.promo_dropped).toBe(true);
  });

  it("Stripe: below the authorized amount → update_amount job; above → amount_exceeds_authorization", async () => {
    const o = await order({ items: [{ item_id: ITEM.ramen, qty: 2 }] }); // 29.90
    const pi = `pi_edit_${Date.now().toString(36)}`;
    await admin().from("orders").update({ payment_intent_id: pi, payment_provider: "stripe" }).eq("id", o.id);
    await admin().rpc("record_payment_event", toRecordPaymentEventArgs(fx.amountCapturableUpdated(pi, o.id, o.total) as any));

    const { error: over } = await edit(operator, o.id, [{ item_id: ITEM.ramen, qty: 3 }]);
    expect(over!.message).toBe("amount_exceeds_authorization");
    const { data: under, error } = await edit(operator, o.id, [{ item_id: ITEM.ramen, qty: 1 }]);
    expect(error).toBeNull();
    expect(under.total_cents).toBe(1350 + 290);
    const { data: jobs } = await admin().from("payment_jobs").select("action, amount_cents, status").eq("order_id", o.id);
    expect(jobs).toEqual([{ action: "update_amount", amount_cents: 1640, status: "queued" }]);
  });
});
