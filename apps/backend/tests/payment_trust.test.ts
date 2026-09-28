import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, ramenOrder, rpc, signIn, STAFF, type Db } from "./helpers";

beforeAll(openAllDay);

/**
 * S7-01 finding 1 (CRITICAL) — the payment trust boundary. See migration 25.
 * The rule in one line: **nobody but the payment provider may say that money moved.**
 */
const setStatus = (c: Db, order_id: string, new_status: string, payload: Record<string, unknown> = {}) =>
  rpc(c, "set_order_status", { order_id, new_status, payload });

async function deliver(operator: Db, kitchen: Db, id: string, payload: Record<string, unknown> = {}) {
  await setStatus(operator, id, "accepted");
  await setStatus(kitchen, id, "preparing");
  await setStatus(kitchen, id, "ready");
  await setStatus(operator, id, "out_for_delivery", { driver_id: STAFF.driver.id });
  return setStatus(operator, id, "delivered", payload);
}

describe("place_order: a guest cannot claim a payment state", () => {
  for (const method of ["card", "apple_pay", "google_pay", "paypal", "bitcoin"] as const) {
    it(`refuses payment_status 'authorized' for ${method}`, async () => {
      const { data, error } = await rpc(anon(), "place_order", {
        payload: ramenOrder({ payment_method: method, payment_status: "authorized" }),
      });
      expect(data).toBeNull();
      expect(error!.message).toBe("order_rejected");
      expect(JSON.parse(error!.details)).toContainEqual(
        expect.objectContaining({ code: "invalid_input", field: "payment_status" }),
      );
    });
  }

  it("refuses 'paid' and 'failed' too — pending is the only guest-creatable state", async () => {
    for (const ps of ["paid", "failed", "refunded"]) {
      const { error } = await rpc(anon(), "place_order", { payload: ramenOrder({ payment_status: ps }) });
      expect(error, ps).not.toBeNull();
      expect(error!.message, ps).toBe("order_rejected");
    }
    const { error: ok } = await rpc(anon(), "place_order", { payload: ramenOrder({ payment_status: "pending" }) });
    expect(ok, "an explicit 'pending' is still fine").toBeNull();
  });

  it("never auto-accepts a guest order, however cheap — auto-accept needs a vouched payment", async () => {
    // well under ops.auto_accept_paid_under_cents (5000)
    const { data, error } = await rpc(anon(), "place_order", {
      payload: ramenOrder({ items: [{ item_id: "30000000-0000-4000-8000-000000000009", qty: 1 }] }),
    });
    expect(error).toBeNull();
    expect(data.status).toBe("new");
  });

  it("writes no payment_authorized event on any guest path", async () => {
    const { data } = await rpc(anon(), "place_order", { payload: ramenOrder() });
    const { data: ev } = await admin().from("order_events").select("type").eq("order_id", data.order_id);
    expect(ev!.map((e) => e.type)).not.toContain("payment_authorized");
  });
});

describe("place_order: staff may record money in hand, and it is audited", () => {
  let operator: Db;
  beforeAll(async () => { operator = await signIn("operator"); });

  it("operator can create a paid phone order; it auto-accepts and names the actor", async () => {
    const { data, error } = await rpc(operator, "place_order", {
      payload: ramenOrder({
        channel: "phone", payment_status: "paid", payment_method: "card", payment_ref: "Terminal ···9021",
        items: [{ item_id: "30000000-0000-4000-8000-000000000009", qty: 1 }],
      }),
    });
    expect(error).toBeNull();
    const { data: o } = await admin().from("orders")
      .select("payment_status, payment_ref, channel, status").eq("id", data.order_id).single();
    expect(o!.payment_status).toBe("paid");
    expect(o!.payment_ref).toBe("Terminal ···9021");   // staff reference is kept, unlike a guest's
    expect(o!.channel).toBe("phone");

    const { data: ev } = await admin().from("order_events")
      .select("type, actor_type, actor_id, payload").eq("order_id", data.order_id).order("at");
    const note = ev!.find((e) => e.type === "note")!;
    expect(note, "a staff-recorded payment must leave an audit trail").toBeTruthy();
    expect(note.payload).toMatchObject({ code: "payment_recorded_by_staff", payment_method: "card" });
    expect(note.actor_type).toBe("staff");
    expect(note.actor_id).toBe(STAFF.operator.id);
  });

  it("even staff cannot claim 'authorized' — that word belongs to the provider", async () => {
    const { error } = await rpc(operator, "place_order", {
      payload: ramenOrder({ channel: "phone", payment_status: "authorized" }),
    });
    expect(error!.message).toBe("order_rejected");
    expect(JSON.parse(error!.details)).toContainEqual(
      expect.objectContaining({ code: "invalid_input", field: "payment_status" }),
    );
  });

  it("kitchen and driver are not staff for this purpose", async () => {
    for (const role of ["kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { error } = await rpc(c, "place_order", { payload: ramenOrder({ payment_status: "paid" }) });
      expect(error, role).not.toBeNull();
    }
  });
});

describe("set_order_status: completion is not evidence of payment", () => {
  let operator: Db, kitchen: Db;
  beforeAll(async () => { [operator, kitchen] = await Promise.all([signIn("operator"), signIn("kitchen")]); });

  it("a delivered card order with no provider stays pending and is flagged", async () => {
    const { data: r } = await rpc(anon(), "place_order", { payload: ramenOrder({ payment_method: "card" }) });
    const { data: done, error } = await deliver(operator, kitchen, r.order_id);
    expect(error).toBeNull();
    expect(done.status).toBe("delivered");
    expect(done.payment_status, "no Stripe, no money — completion must not mark it paid").toBe("pending");
    expect(done.payment_captured_at).toBeNull();

    const { data: ev } = await admin().from("order_events")
      .select("payload").eq("order_id", r.order_id).eq("type", "note");
    expect(ev!.some((e) => (e.payload as { code?: string }).code === "payment_not_confirmed")).toBe(true);
  });

  it("cash is unaffected — confirmation still pays the order", async () => {
    const { data: r } = await rpc(anon(), "place_order", { payload: ramenOrder({ payment_method: "cash" }) });
    const { data: done } = await deliver(operator, kitchen, r.order_id, { cash_received: true });
    expect(done.payment_status).toBe("paid");
    expect(done.payment_captured_at).not.toBeNull();
  });

  it("a staff-recorded paid order stays paid on completion, with no spurious flag", async () => {
    const { data: r } = await rpc(operator, "place_order", {
      payload: ramenOrder({ channel: "phone", payment_status: "paid", payment_method: "card" }),
    });
    const { data: done } = await deliver(operator, kitchen, r.order_id);
    expect(done.payment_status).toBe("paid");
    const { data: ev } = await admin().from("order_events")
      .select("payload").eq("order_id", r.order_id).eq("type", "note");
    expect(ev!.some((e) => (e.payload as { code?: string }).code === "payment_not_confirmed")).toBe(false);
  });

  it("the webhook remains the only route to `authorized`", async () => {
    const { data: r } = await rpc(anon(), "place_order", { payload: ramenOrder() });
    const { data: before } = await admin().from("orders").select("payment_status").eq("id", r.order_id).single();
    expect(before!.payment_status).toBe("pending");

    // what record_payment_event does when Stripe says the intent is capturable
    const { error } = await admin().rpc("record_payment_event", {
      p_provider: "stripe",
      p_event_id: `evt_trust_${r.order_id}`,
      p_type: "payment_intent.amount_capturable_updated",
      p_payload: { data: { object: { id: `pi_trust_${r.number}`, amount_capturable: 2700, metadata: { order_id: r.order_id } } } },
      p_payment_ref: "Visa ···4242",
      p_payment_method: "card",
    });
    expect(error).toBeNull();
    const { data: after } = await admin().from("orders")
      .select("payment_status, payment_authorized_cents, payment_ref").eq("id", r.order_id).single();
    expect(after!.payment_status).toBe("authorized");
    expect(after!.payment_authorized_cents).toBe(2700);
    expect(after!.payment_ref).toBe("Visa ···4242");
  });
});
