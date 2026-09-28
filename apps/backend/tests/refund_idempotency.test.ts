import { describe, expect, it } from "vitest";
import {
  findRefundForJob, planRefund, refundIdempotencyKey,
  type ExistingRefund, type RefundJob,
} from "../supabase/functions/_shared/refund-plan";
import { timingSafeEqual, bearerToken } from "../supabase/functions/_shared/secure-compare";

/**
 * S7-01 finding 2 — `payment-worker` could refund twice. `payment_jobs` re-claims a job after 10
 * minutes; if the worker died between `stripe.refunds.create()` resolving and `finish_payment_job`
 * committing, the retry used a *new* idempotency key (`job:<id>:<attempt+1>`), so Stripe treated it
 * as a fresh request and refunded the customer again.
 *
 * These are pure-function tests on purpose: the failure is a sequence (call Stripe → crash →
 * reclaim), and a pure planner lets the sequence be played out exactly, with no Stripe account,
 * no network and no flakiness. The two halves of the fix are asserted separately below.
 */
const PI = { status: "succeeded", amount_received: 4000 };
const ORDER = { payment_refunded_cents: 0 };
const job = (over: Partial<RefundJob> = {}): RefundJob =>
  ({ id: "11111111-1111-4111-8111-111111111111", order_id: "order-1", amount_cents: null, attempts: 0, ...over });

/** What Stripe would hold after a `refunds.create` from this job. */
const refundFrom = (j: RefundJob, amount: number): ExistingRefund =>
  ({ id: "re_1", amount, status: "succeeded", metadata: { order_id: j.order_id, job_id: j.id } });

describe("refund idempotency key", () => {
  it("is stable across attempts — this is what makes Stripe replay instead of re-refund", () => {
    const a = refundIdempotencyKey(job({ attempts: 0 }).id);
    const b = refundIdempotencyKey(job({ attempts: 7 }).id);
    expect(a).toBe(b);
    expect(a).not.toContain("0");   // no attempt number smuggled in
    expect(a).toBe("refund:job:11111111-1111-4111-8111-111111111111");
  });

  it("differs per job, so two real refunds on one order are still two refunds", () => {
    expect(refundIdempotencyKey("job-a")).not.toBe(refundIdempotencyKey("job-b"));
  });
});

describe("crash between Stripe and finish_payment_job, then reclaim", () => {
  it("does not refund a second time", () => {
    const j = job({ attempts: 0 });

    // attempt 0: nothing refunded yet → issue the refund
    const first = planRefund(j, PI, ORDER, []);
    expect(first).toEqual({ kind: "create", amount: 4000, idempotencyKey: refundIdempotencyKey(j.id) });

    // …Stripe refunds 4000 … worker process dies … finish_payment_job never runs, so
    // orders.payment_refunded_cents is still 0 and the job goes back to `queued` after 10 minutes.
    const atStripe = [refundFrom(j, 4000)];

    // attempt 1: the reclaim. The old code would have called refunds.create again with a fresh key.
    const second = planRefund({ ...j, attempts: 1 }, PI, ORDER, atStripe);
    expect(second).toEqual({ kind: "already", refund_id: "re_1", amount: 4000, status: "succeeded" });
  });

  it("recognises its own refund even when the webhook has since updated the order", () => {
    const j = job();
    const second = planRefund({ ...j, attempts: 1 }, PI, { payment_refunded_cents: 4000 }, [refundFrom(j, 4000)]);
    expect(second.kind).toBe("already");
  });

  it("ignores refunds made by other jobs — a partial refund does not block a later one", () => {
    const mine = job({ id: "job-2", amount_cents: 1000 });
    const someoneElse: ExistingRefund = { id: "re_0", amount: 1500, status: "succeeded", metadata: { job_id: "job-1" } };
    const plan = planRefund(mine, PI, { payment_refunded_cents: 1500 }, [someoneElse]);
    expect(plan).toEqual({ kind: "create", amount: 1000, idempotencyKey: "refund:job:job-2" });
  });

  it("a failed or canceled refund is not treated as done", () => {
    const j = job();
    for (const status of ["failed", "canceled"]) {
      const plan = planRefund(j, PI, ORDER, [{ ...refundFrom(j, 4000), status }]);
      expect(plan.kind, status).toBe("create");
    }
  });

  it("findRefundForJob matches on job_id only", () => {
    const j = job();
    expect(findRefundForJob([refundFrom(j, 100)], j.id)).toBeTruthy();
    expect(findRefundForJob([refundFrom(j, 100)], "other")).toBeUndefined();
    expect(findRefundForJob([], j.id)).toBeUndefined();
  });
});

describe("refund amount rules are unchanged", () => {
  it("refuses an intent that is not succeeded, and marks canceled final", () => {
    expect(planRefund(job(), { status: "requires_capture", amount_received: 0 }, ORDER, []))
      .toMatchObject({ kind: "error", final: false });
    expect(planRefund(job(), { status: "canceled", amount_received: 0 }, ORDER, []))
      .toMatchObject({ kind: "error", final: true });
  });

  it("refuses an amount outside 1..remaining", () => {
    expect(planRefund(job({ amount_cents: 5000 }), PI, ORDER, [])).toMatchObject({ kind: "error", final: true });
    expect(planRefund(job({ amount_cents: 0 }), PI, ORDER, [])).toMatchObject({ kind: "error", final: true });
    expect(planRefund(job({ amount_cents: 1000 }), PI, { payment_refunded_cents: 3500 }, []))
      .toMatchObject({ kind: "error", final: true });
  });

  it("a partial refund leaves the rest refundable", () => {
    expect(planRefund(job({ amount_cents: 1000 }), PI, { payment_refunded_cents: 1000 }, []))
      .toMatchObject({ kind: "create", amount: 1000 });
  });
});

describe("constant-time comparison (S7-01 finding 4) and bearer parsing", () => {
  it("equal strings match, different ones do not", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("null / undefined / non-strings never match — a missing token is not an empty token", () => {
    expect(timingSafeEqual(null, null)).toBe(false);
    expect(timingSafeEqual(undefined, "")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual(null, "secret")).toBe(false);
  });

  it("compares every character instead of bailing at the first difference", () => {
    // A wall-clock timing assertion is unreliable on a shared CI runner, so assert the property
    // that makes it constant time: the loop accumulates into a mask and never returns early.
    // The comparison loop must accumulate into a mask rather than return at the first mismatch.
    // (The length guard before it is deliberate and fine — a length is not a secret.) Asserting on
    // the loop line keeps this honest without a wall-clock timing measurement, which is not
    // reliable on a shared CI runner.
    const loopLine = timingSafeEqual.toString().split("\n").find((l) => l.includes("for ("))!;
    expect(loopLine, "must accumulate differences, not short-circuit").toContain("|=");
    expect(loopLine, "no early exit from the comparison loop").not.toContain("return");

    // and it agrees with a plain comparison on every same-length pair
    const pairs: Array<[string, string]> = [["aaaa", "aaaa"], ["aaaa", "baaa"], ["aaaa", "aaab"], ["", ""]];
    for (const [a, b] of pairs) expect(timingSafeEqual(a, b), `${a}/${b}`).toBe(a === b);
  });

  it("bearerToken reads Authorization, and only Bearer", () => {
    const req = (h: Record<string, string>) => new Request("https://x/", { method: "POST", headers: h });
    expect(bearerToken(req({ Authorization: "Bearer abc" }))).toBe("abc");
    expect(bearerToken(req({ Authorization: "Basic abc" }))).toBeNull();
    expect(bearerToken(req({}))).toBeNull();
    expect(bearerToken(req({ Authorization: "Bearer   " }))).toBeNull();
  });
});
