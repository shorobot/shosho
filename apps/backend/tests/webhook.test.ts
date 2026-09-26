import { beforeAll, describe, expect, it } from "vitest";
import { signPayload, verifyStripeSignature } from "../supabase/functions/_shared/stripe-signature";
import { describePaymentMethod, orderIdOf, paymentIntentIdOf, paymentMethodIdOf, toRecordPaymentEventArgs } from "../supabase/functions/_shared/stripe-mapping";
import * as fx from "./fixtures/stripe/events";
import { admin, anon, ITEM, openAllDay, ramenOrder, rpc, signIn } from "./helpers";

beforeAll(openAllDay);

const SECRET = "whsec_test_0123456789abcdef";
let piSeq = 0;
const newPi = () => `pi_test_${Date.now().toString(36)}${(++piSeq).toString(36)}`;

/** Order with a Stripe intent attached (what create-payment-intent does), payment still pending. */
async function stripeOrder(overrides: Record<string, unknown> = {}) {
  const { data, error } = await rpc(anon(), "place_order", { payload: ramenOrder(overrides) });
  if (error) throw new Error(error.message + " " + error.details);
  const pi = newPi();
  const { error: e } = await admin().from("orders").update({ payment_intent_id: pi, payment_provider: "stripe" }).eq("id", data.order_id);
  if (e) throw e;
  return { id: data.order_id as string, pi, total: data.total_cents as number, token: data.tracking_token as string };
}

/** Same call the Edge Function makes after the signature check. */
async function deliver(ev: fx.Fixture | Record<string, unknown>, pm?: Record<string, unknown> | null) {
  const body = JSON.stringify(ev);
  const sig = await signPayload(SECRET, body);
  const check = await verifyStripeSignature(body, sig, SECRET);
  expect(check.ok).toBe(true);
  const { data, error } = await admin().rpc("record_payment_event", toRecordPaymentEventArgs(JSON.parse(body), pm as any));
  if (error) throw new Error(error.message + " " + error.details);
  return data as { duplicate: boolean; applied: boolean; order_id: string | null; payment_status: string; status: string };
}

describe("stripe signature (Edge Function _shared)", () => {
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded", data: { object: {} } });

  it("accepts a header signed with the secret", async () => {
    const h = await signPayload(SECRET, body, 1_800_000_000);
    expect(await verifyStripeSignature(body, h, SECRET, { now: 1_800_000_100 })).toEqual({ ok: true, timestamp: 1_800_000_000 });
  });
  it("accepts when any v1 matches (secret rotation)", async () => {
    const h = await signPayload(SECRET, body, 1_800_000_000);
    const rotated = h.replace("v1=", "v1=deadbeef,v1=");
    expect((await verifyStripeSignature(body, rotated, SECRET, { now: 1_800_000_000 })).ok).toBe(true);
  });
  it("rejects wrong secret, tampered body, stale timestamp, missing header", async () => {
    const h = await signPayload(SECRET, body, 1_800_000_000);
    expect(await verifyStripeSignature(body, h, "whsec_other", { now: 1_800_000_000 })).toMatchObject({ ok: false, reason: "signature_mismatch" });
    expect(await verifyStripeSignature(body + " ", h, SECRET, { now: 1_800_000_000 })).toMatchObject({ ok: false, reason: "signature_mismatch" });
    expect(await verifyStripeSignature(body, h, SECRET, { now: 1_800_000_000 + 301 })).toMatchObject({ ok: false, reason: "timestamp_out_of_tolerance" });
    expect(await verifyStripeSignature(body, null, SECRET)).toMatchObject({ ok: false, reason: "missing_header" });
    expect(await verifyStripeSignature(body, "t=abc", SECRET)).toMatchObject({ ok: false, reason: "malformed_header" });
    expect(await verifyStripeSignature(body, "t=1800000000", SECRET, { now: 1_800_000_000 })).toMatchObject({ ok: false, reason: "no_v1" });
  });
});

describe("stripe → schema mapping (Edge Function _shared)", () => {
  it("finds the intent, order and payment method on each event type", () => {
    const acu = fx.amountCapturableUpdated("pi_1", "10000000-0000-4000-8000-000000000001", 1000, "pm_9");
    expect(paymentIntentIdOf(acu)).toBe("pi_1");
    expect(orderIdOf(acu)).toBe("10000000-0000-4000-8000-000000000001");
    expect(paymentMethodIdOf(acu)).toBe("pm_9");
    const ch = fx.chargeRefunded("pi_1", "not-a-uuid", 1000, 1000);
    expect(paymentIntentIdOf(ch)).toBe("pi_1");
    expect(orderIdOf(ch)).toBeNull();
    expect(paymentMethodIdOf(ch)).toBeNull();
  });
  it("describes payment methods the way the back-office shows them", () => {
    expect(describePaymentMethod(fx.visaPaymentMethod)).toEqual({ ref: "Visa ···4242", method: "card" });
    expect(describePaymentMethod(fx.applePayPaymentMethod)).toEqual({ ref: "Apple Pay ···4444", method: "apple_pay" });
    expect(describePaymentMethod(fx.paypalPaymentMethod)).toEqual({ ref: "PayPal", method: "paypal" });
    expect(describePaymentMethod(null)).toEqual({ ref: null, method: null });
    const args = toRecordPaymentEventArgs(fx.succeeded("pi_2", "10000000-0000-4000-8000-000000000001", 500));
    expect(args).toMatchObject({ p_provider: "stripe", p_type: "payment_intent.succeeded", p_payment_intent_id: "pi_2", p_payment_ref: null });
  });
});

describe("record_payment_event (webhook state machine)", () => {
  it("authorization → authorized + payment_authorized event + auto-accept (< 50 €, ASAP)", async () => {
    const o = await stripeOrder();
    const r = await deliver(fx.amountCapturableUpdated(o.pi, o.id, o.total), fx.visaPaymentMethod);
    expect(r).toMatchObject({ duplicate: false, applied: true, payment_status: "authorized", status: "accepted" });
    const { data: row } = await admin().from("orders").select("*").eq("id", o.id).single();
    expect(row).toMatchObject({ payment_status: "authorized", payment_authorized_cents: o.total, payment_ref: "Visa ···4242", payment_method: "card", status: "accepted" });
    const { data: ev } = await admin().from("order_events").select("type, actor_type").eq("order_id", o.id).order("at");
    expect(ev!.map((e) => e.type)).toEqual(["created", "payment_authorized", "accepted"]);
    expect(ev![2].actor_type).toBe("system");
    const { data: pe } = await admin().from("payment_events").select("*").eq("order_id", o.id);
    expect(pe).toHaveLength(1);
    expect(pe![0].type).toBe("payment_intent.amount_capturable_updated");
  });

  it("is idempotent per event id and finds the order by intent when metadata is missing", async () => {
    const o = await stripeOrder({ items: [{ item_id: ITEM.ramen, qty: 4 }] }); // 54.00 > 50 € → no auto-accept
    const ev = fx.amountCapturableUpdated(o.pi, o.id, o.total);
    delete (ev.data.object as any).metadata;
    const first = await deliver(ev);
    expect(first).toMatchObject({ applied: true, order_id: o.id, status: "new", payment_status: "authorized" });
    const again = await deliver(ev);
    expect(again).toMatchObject({ duplicate: true, applied: false });
    const { data: pe } = await admin().from("payment_events").select("id").eq("order_id", o.id);
    expect(pe).toHaveLength(1);
    // Apple Pay via wallet
    const o2 = await stripeOrder();
    await deliver(fx.amountCapturableUpdated(o2.pi, o2.id, o2.total, "pm_test_apple"), fx.applePayPaymentMethod);
    const { data: row } = await admin().from("orders").select("payment_ref, payment_method").eq("id", o2.id).single();
    expect(row).toEqual({ payment_ref: "Apple Pay ···4444", payment_method: "apple_pay" });
  });

  it("no auto-accept when the kitchen is paused or the order is a pre-order", async () => {
    const operator = await signIn("operator");
    await rpc(operator, "kitchen_pause", { paused: true });
    try {
      const o = await stripeOrder({ scheduled_for: new Date(Date.now() + 2 * 3600_000).toISOString() });
      const r = await deliver(fx.amountCapturableUpdated(o.pi, o.id, o.total));
      expect(r).toMatchObject({ payment_status: "authorized", status: "new" });
    } finally {
      await rpc(operator, "kitchen_pause", { paused: false });
    }
  });

  it("failed → failed; a later authorization recovers; succeeded → paid + captured_at", async () => {
    const o = await stripeOrder();
    const f = await deliver(fx.paymentFailed(o.pi, o.id, o.total));
    expect(f).toMatchObject({ applied: true, payment_status: "failed" });
    const { data: ev } = await admin().from("order_events").select("type, payload").eq("order_id", o.id).eq("type", "note");
    expect(ev![0].payload).toMatchObject({ code: "card_declined" });
    const a = await deliver(fx.amountCapturableUpdated(o.pi, o.id, o.total));
    expect(a.payment_status).toBe("authorized");
    const s = await deliver(fx.succeeded(o.pi, o.id, o.total));
    expect(s.payment_status).toBe("paid");
    const { data: row } = await admin().from("orders").select("payment_captured_at").eq("id", o.id).single();
    expect(row!.payment_captured_at).toBeTruthy();
  });

  it("canceled releases the authorization; charge.refunded partial / full", async () => {
    const o = await stripeOrder();
    await deliver(fx.amountCapturableUpdated(o.pi, o.id, o.total));
    const c = await deliver(fx.canceled(o.pi, o.id, o.total));
    expect(c.payment_status).toBe("pending");

    const o2 = await stripeOrder();
    await deliver(fx.amountCapturableUpdated(o2.pi, o2.id, o2.total));
    await deliver(fx.succeeded(o2.pi, o2.id, o2.total));
    const part = await deliver(fx.chargeRefunded(o2.pi, o2.id, o2.total, 500));
    expect(part.payment_status).toBe("paid");
    let { data: row } = await admin().from("orders").select("payment_refunded_cents").eq("id", o2.id).single();
    expect(row!.payment_refunded_cents).toBe(500);
    const full = await deliver(fx.chargeRefunded(o2.pi, o2.id, o2.total, o2.total));
    expect(full.payment_status).toBe("refunded");
    ({ data: row } = await admin().from("orders").select("payment_refunded_cents").eq("id", o2.id).single());
    expect(row!.payment_refunded_cents).toBe(o2.total);
  });

  it("unknown intent is logged, not applied; anon / staff cannot call it", async () => {
    const r = await deliver(fx.succeeded("pi_unknown_" + Date.now(), "00000000-0000-4000-8000-000000000000", 100));
    expect(r).toMatchObject({ duplicate: false, applied: false, order_id: null });
    const { error } = await anon().rpc("record_payment_event", { p_provider: "stripe", p_event_id: "x", p_type: "y", p_payload: {} });
    expect(error).not.toBeNull();
    const operator = await signIn("operator");
    const { error: e2 } = await operator.rpc("record_payment_event", { p_provider: "stripe", p_event_id: "x", p_type: "y", p_payload: {} });
    expect(e2).not.toBeNull();
    // staff can read the payment trail, anon cannot
    const { data: pe, error: e3 } = await operator.from("payment_events").select("id").limit(1);
    expect(e3).toBeNull();
    expect(pe!.length).toBeGreaterThan(0);
    const { data: none } = await anon().from("payment_events").select("id").limit(1);
    expect(none).toEqual([]);
  });
});
