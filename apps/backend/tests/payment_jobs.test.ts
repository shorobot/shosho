import { beforeAll, describe, expect, it } from "vitest";
import * as fx from "./fixtures/stripe/events";
import { toRecordPaymentEventArgs } from "../supabase/functions/_shared/stripe-mapping";
import { admin, anon, openAllDay, ramenOrder, rpc, signIn, STAFF, type Db } from "./helpers";

beforeAll(openAllDay);

let piSeq = 0;
const newPi = () => `pi_jobs_${Date.now().toString(36)}${(++piSeq).toString(36)}`;

async function order(overrides: Record<string, unknown> = {}) {
  const { data, error } = await rpc(anon(), "place_order", { payload: ramenOrder(overrides) });
  if (error) throw new Error(error.message + " " + error.details);
  return { id: data.order_id as string, total: data.total_cents as number };
}
async function stripeAuthorized(overrides: Record<string, unknown> = {}) {
  const o = await order(overrides);
  const pi = newPi();
  await admin().from("orders").update({ payment_intent_id: pi, payment_provider: "stripe" }).eq("id", o.id);
  const { error } = await admin().rpc("record_payment_event", toRecordPaymentEventArgs(fx.amountCapturableUpdated(pi, o.id, o.total) as any));
  if (error) throw error;
  return { ...o, pi };
}
const setStatus = (c: Db, order_id: string, new_status: string, payload: Record<string, unknown> = {}) =>
  rpc(c, "set_order_status", { order_id, new_status, payload });
const jobs = async (order_id: string) =>
  (await admin().from("payment_jobs").select("*").eq("order_id", order_id).order("created_at")).data!;

describe("set_order_status × Stripe (payment_jobs)", () => {
  let operator: Db, driver: Db;
  beforeAll(async () => {
    [operator, driver] = await Promise.all([signIn("operator"), signIn("driver")]);
  });

  it("delivered enqueues capture; payment stays authorized until the webhook says paid; refund enqueues refund", async () => {
    const o = await stripeAuthorized();
    // auto-accepted by the webhook (< 50 €)
    await setStatus(operator, o.id, "preparing");
    await setStatus(operator, o.id, "ready");
    await setStatus(operator, o.id, "out_for_delivery", { driver_id: STAFF.driver.id });
    const { data: del, error } = await setStatus(driver, o.id, "delivered");
    expect(error).toBeNull();
    expect(del.status).toBe("delivered");
    expect(del.payment_status).toBe("authorized"); // capture is asynchronous
    let j = await jobs(o.id);
    expect(j.map((x) => [x.action, x.status, x.amount_cents])).toEqual([["capture", "queued", o.total]]);

    // refund needs `paid` → not yet
    const { error: early } = await setStatus(operator, o.id, "refunded");
    expect(early!.message).toBe("illegal_transition");

    // worker captured → Stripe sends payment_intent.succeeded
    await admin().rpc("record_payment_event", toRecordPaymentEventArgs(fx.succeeded(o.pi, o.id, o.total) as any));
    const { data: ref, error: e2 } = await setStatus(operator, o.id, "refunded", { amount_cents: 300 });
    expect(e2).toBeNull();
    expect(ref.status).toBe("refunded");
    expect(ref.payment_status).toBe("paid"); // until charge.refunded arrives
    j = await jobs(o.id);
    expect(j.map((x) => [x.action, x.amount_cents])).toEqual([["capture", o.total], ["refund", 300]]);
    // refund amount validation
    const o2 = await stripeAuthorized({ type: "pickup", address: undefined });
    await setStatus(operator, o2.id, "preparing");
    await setStatus(operator, o2.id, "ready");
    await setStatus(operator, o2.id, "picked_up");
    await admin().rpc("record_payment_event", toRecordPaymentEventArgs(fx.succeeded(o2.pi, o2.id, o2.total) as any));
    const { error: tooMuch } = await setStatus(operator, o2.id, "refunded", { amount_cents: o2.total + 1 });
    expect(tooMuch!.message).toBe("invalid_input");
  });

  it("cancelled enqueues void (authorization released by the webhook), once per order", async () => {
    const o = await stripeAuthorized();
    const { data: c } = await setStatus(operator, o.id, "cancelled", { cancel_reason: "kitchen" });
    expect(c.payment_status).toBe("authorized"); // released when payment_intent.canceled arrives
    const j = await jobs(o.id);
    expect(j.map((x) => x.action)).toEqual(["void"]);
    // duplicate enqueue coalesces with the queued job
    const { data: id1 } = await admin().rpc("enqueue_payment_job", { p_order_id: o.id, p_action: "void" });
    expect(id1).toBe(j[0].id);
    await admin().rpc("record_payment_event", toRecordPaymentEventArgs(fx.canceled(o.pi, o.id, o.total) as any));
    const { data: row } = await admin().from("orders").select("payment_status").eq("id", o.id).single();
    expect(row!.payment_status).toBe("pending");
  });

  it("non-Stripe orders keep the v1 behaviour (delivered → paid, cancelled → pending)", async () => {
    const o = await order();
    await setStatus(operator, o.id, "accepted");
    await setStatus(operator, o.id, "preparing");
    await setStatus(operator, o.id, "ready");
    await setStatus(operator, o.id, "out_for_delivery", { driver_id: STAFF.driver.id });
    const { data: d } = await setStatus(driver, o.id, "delivered");
    expect(d.payment_status).toBe("paid");
    expect(d.payment_captured_at).toBeTruthy();
    expect(await jobs(o.id)).toEqual([]);
  });

  it("cash: driver confirms cash_received → paid; without it → pending + note", async () => {
    const paid = await order({ payment_method: "cash" });
    await setStatus(operator, paid.id, "accepted");
    await setStatus(operator, paid.id, "preparing");
    await setStatus(operator, paid.id, "ready");
    await setStatus(operator, paid.id, "out_for_delivery", { driver_id: STAFF.driver.id });
    const { data: d1 } = await setStatus(driver, paid.id, "delivered", { cash_received: true });
    expect(d1.payment_status).toBe("paid");

    const unpaid = await order({ payment_method: "cash" });
    await setStatus(operator, unpaid.id, "accepted");
    await setStatus(operator, unpaid.id, "preparing");
    await setStatus(operator, unpaid.id, "ready");
    await setStatus(operator, unpaid.id, "out_for_delivery", { driver_id: STAFF.driver.id });
    const { data: d2 } = await setStatus(driver, unpaid.id, "delivered", { cash_received: false });
    expect(d2.payment_status).toBe("pending");
    const { data: ev } = await admin().from("order_events").select("type, payload").eq("order_id", unpaid.id).eq("type", "note");
    expect(ev![0].payload).toMatchObject({ code: "cash_not_received" });
    expect(await jobs(unpaid.id)).toEqual([]);
  });
});

describe("payment_jobs state machine (claim / finish)", () => {
  it("claim marks processing + attempts; finish → done | queued (retry) | failed (final or 5 attempts)", async () => {
    const o = await stripeAuthorized();
    const a = admin();
    const { data: id } = await a.rpc("enqueue_payment_job", { p_order_id: o.id, p_action: "capture", p_amount_cents: o.total });
    const { data: claimed } = await a.rpc("claim_payment_jobs", { p_limit: 100 });
    const mine = (claimed as any[]).find((j) => j.id === id);
    expect(mine).toMatchObject({ status: "processing", attempts: 1 });
    // claiming again does not hand out a job that is being processed
    const { data: again } = await a.rpc("claim_payment_jobs", { p_limit: 100 });
    expect((again as any[]).some((j) => j.id === id)).toBe(false);

    const { data: retry } = await a.rpc("finish_payment_job", { p_job_id: id, p_ok: false, p_error: "network" });
    expect(retry).toMatchObject({ status: "queued", attempts: 1, last_error: "network" });

    await a.rpc("claim_payment_jobs", { p_limit: 100 });
    const { data: done } = await a.rpc("finish_payment_job", { p_job_id: id, p_ok: true, p_result: { status: "succeeded" } });
    expect(done).toMatchObject({ status: "done", attempts: 2, last_error: null, result: { status: "succeeded" } });
    expect(done.finished_at).toBeTruthy();

    // final failure
    const { data: id2 } = await a.rpc("enqueue_payment_job", { p_order_id: o.id, p_action: "void" });
    await a.rpc("claim_payment_jobs", { p_limit: 100 });
    const { data: failed } = await a.rpc("finish_payment_job", { p_job_id: id2, p_ok: false, p_error: "already captured", p_final: true });
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });

    // 5 attempts → failed
    const { data: id3 } = await a.rpc("enqueue_payment_job", { p_order_id: o.id, p_action: "refund", p_amount_cents: 100 });
    let last: any;
    for (let i = 0; i < 5; i++) {
      await a.rpc("claim_payment_jobs", { p_limit: 100 });
      ({ data: last } = await a.rpc("finish_payment_job", { p_job_id: id3, p_ok: false, p_error: `try ${i + 1}` }));
    }
    expect(last).toMatchObject({ status: "failed", attempts: 5, last_error: "try 5" });

    // staff read the queue, anon and staff cannot claim
    const operator = await signIn("operator");
    const { data: seen } = await operator.from("payment_jobs").select("id").eq("order_id", o.id);
    expect(seen!.length).toBe(3);
    const { error: e1 } = await operator.rpc("claim_payment_jobs", { p_limit: 1 });
    expect(e1).not.toBeNull();
    const { error: e2 } = await anon().rpc("claim_payment_jobs", { p_limit: 1 });
    expect(e2).not.toBeNull();
  });
});
