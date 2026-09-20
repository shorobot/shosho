import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, freshPhone, ITEM, POSTAL, openAllDay, ramenOrder, rpc } from "./helpers";

beforeAll(openAllDay);

describe("place_order", () => {
  it("happy path: order + items + created event + customer upsert + tracking token", async () => {
    const phone = freshPhone();
    const payload = ramenOrder({ contact: { name: "Anna Test", phone }, tip_cents: 100, courier_comment: "2nd floor" });
    const { data: r, error } = await rpc(anon(), "place_order", { payload });
    expect(error).toBeNull();
    expect(r.number).toBeGreaterThanOrEqual(1000);
    expect(r.total_cents).toBe(2700 + 290 + 100);
    expect(r.tracking_token).toMatch(/^[0-9a-f]{32}$/);
    expect(r.status).toBe("new");

    const a = admin();
    const { data: o } = await a.from("orders").select("*").eq("id", r.order_id).single();
    expect(o!.type).toBe("delivery");
    expect(o!.zone_id).toBe("50000000-0000-4000-8000-000000000002");
    expect(o!.contact_phone).toBe(phone);
    expect(o!.address).toMatchObject({ street: "Kastanienallee 1", postal_code: POSTAL.zoneB, city: "Berlin" });
    expect(o!.promised_minutes).toBe(60);
    expect(o!.channel).toBe("website");

    const { data: items } = await a.from("order_items").select("*").eq("order_id", r.order_id);
    expect(items).toHaveLength(1);
    expect(items![0]).toMatchObject({ name: "Tonkotsu Ramen", qty: 2, unit_price_cents: 1350, line_total_cents: 2700 });

    const { data: ev } = await a.from("order_events").select("*").eq("order_id", r.order_id);
    expect(ev!.map((e) => e.type)).toEqual(["created"]);
    expect(ev![0].actor_type).toBe("customer");

    const { data: c } = await a.from("customers").select("*").eq("phone", phone).single();
    expect(c!.name).toBe("Anna Test");
    expect(o!.customer_id).toBe(c!.id);
    const { data: addr } = await a.from("customer_addresses").select("*").eq("customer_id", c!.id);
    expect(addr).toHaveLength(1);
    expect(addr![0].is_default).toBe(true);

    // guest tracking
    const { data: t } = await rpc(anon(), "get_order_by_token", { token: r.tracking_token });
    expect(t.number).toBe(r.number);
    expect(t.status).toBe("new");
    expect(t.items).toHaveLength(1);
    expect(t.contact_phone).toBeUndefined();
    const { data: none } = await rpc(anon(), "get_order_by_token", { token: "does-not-exist" });
    expect(none).toBeNull();
  });

  it("phone normalisation + allergy note copied from customer", async () => {
    const a = admin();
    const phone = freshPhone();
    await a.from("customers").insert({ name: "Nut Allergy", phone, kitchen_note: "Nussallergie" });
    const local = "0" + phone.slice(3).replace(/(\d{3})(?=\d)/g, "$1 "); // "+49176…" → "0176 …"
    const { data: r, error } = await rpc(anon(), "place_order", {
      payload: ramenOrder({ contact: { name: "Nut Allergy", phone: local } }),
    });
    expect(error).toBeNull();
    const { data: o } = await a.from("orders").select("allergy_note, contact_phone").eq("id", r.order_id).single();
    expect(o!.contact_phone).toBe(phone);
    expect(o!.allergy_note).toBe("Nussallergie");
  });

  it("refuses with problems (below min order) and writes nothing", async () => {
    const phone = freshPhone();
    const { data, error } = await rpc(anon(), "place_order", {
      payload: ramenOrder({
        items: [{ item_id: ITEM.ramen, qty: 1 }],
        address: { street: "Oranienstraße 1", postal_code: POSTAL.zoneC },
        contact: { name: "X", phone },
      }),
    });
    expect(data).toBeNull();
    expect(error!.message).toBe("order_rejected");
    const problems = JSON.parse(error!.details);
    expect(problems).toContainEqual(expect.objectContaining({ code: "below_min_order" }));
    const { data: c } = await admin().from("customers").select("id").eq("phone", phone);
    expect(c).toHaveLength(0);
  });

  it("refuses out of zone and stoplisted item", async () => {
    const { error: e1 } = await rpc(anon(), "place_order", {
      payload: ramenOrder({ address: { street: "Nowhere 1", postal_code: POSTAL.outside } }),
    });
    expect(JSON.parse(e1!.details)).toContainEqual(expect.objectContaining({ code: "out_of_zone" }));
    const { error: e2 } = await rpc(anon(), "place_order", {
      payload: ramenOrder({ items: [{ item_id: ITEM.ebiTempura, qty: 1 }, { item_id: ITEM.ramen, qty: 2 }] }),
    });
    expect(JSON.parse(e2!.details)).toContainEqual({ code: "unavailable", item_id: ITEM.ebiTempura });
  });

  it("promo first-order rule (WILLKOMMEN) + used_count", async () => {
    const phone = freshPhone();
    const a = admin();
    const { data: before } = await a.from("promo_codes").select("used_count").eq("code", "WILLKOMMEN").single();

    const { data: r1, error: err1 } = await rpc(anon(), "place_order", {
      payload: ramenOrder({ contact: { name: "First", phone }, promo_code: "WILLKOMMEN" }),
    });
    expect(err1).toBeNull();
    expect(r1.total_cents).toBe(2700 - 500 + 290);

    const { data: after } = await a.from("promo_codes").select("used_count").eq("code", "WILLKOMMEN").single();
    expect(after!.used_count).toBe(before!.used_count + 1);

    // second order with the same phone → not a first order any more
    const { error: err2 } = await rpc(anon(), "place_order", {
      payload: ramenOrder({ contact: { name: "First", phone }, promo_code: "WILLKOMMEN" }),
    });
    expect(err2!.message).toBe("order_rejected");
    expect(JSON.parse(err2!.details)).toContainEqual(
      expect.objectContaining({ code: "promo_invalid", reason: "not_first_order" }),
    );
  });

  it("auto-accepts authorized orders under 50 € (ASAP only)", async () => {
    const { data: r } = await rpc(anon(), "place_order", {
      payload: ramenOrder({ payment_status: "authorized", payment_ref: "Visa ···4417" }),
    });
    expect(r.status).toBe("accepted");
    const { data: ev } = await admin().from("order_events").select("type, actor_type").eq("order_id", r.order_id).order("at");
    expect(ev!.map((e) => e.type)).toEqual(["created", "payment_authorized", "accepted"]);
    expect(ev![2].actor_type).toBe("system");
  });

  it("rejects when the kitchen is paused (ASAP), accepts pre-orders", async () => {
    const op = await import("./helpers").then((h) => h.signIn("operator"));
    const { data: st, error } = await rpc(op, "kitchen_pause", { paused: true });
    expect(error).toBeNull();
    expect(st.paused).toBe(true);
    try {
      const { error: e } = await rpc(anon(), "place_order", { payload: ramenOrder() });
      expect(JSON.parse(e!.details)).toContainEqual({ code: "closed", reason: "kitchen_paused" });
      const { data: pub } = await anon().from("settings").select("value").eq("key", "kitchen.status").single();
      expect(pub!.value).toMatchObject({ paused: true });

      const slot = new Date(Date.now() + 2 * 3600_000).toISOString();
      const { data: r, error: e2 } = await rpc(anon(), "place_order", { payload: ramenOrder({ scheduled_for: slot }) });
      expect(e2).toBeNull();
      expect(r.status).toBe("new");
    } finally {
      await rpc(op, "kitchen_pause", { paused: false });
    }
  });
});
