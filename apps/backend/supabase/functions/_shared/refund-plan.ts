// [S2-04] Refund planning for payment-worker (S7-01 finding 2).
//
// THE BUG. `capture` and `void` both ask Stripe for the PaymentIntent's live status first and treat
// `succeeded` / `canceled` as "already done", so replaying them is safe. `refund` had no equivalent:
// its only guard was `orders.payment_refunded_cents`, which is written by the `charge.refunded`
// webhook — not by the job. `payment-worker` re-claims a job after 10 minutes, and the retry uses a
// *new* idempotency key (`job:<id>:<attempt>`, attempt has gone up), so Stripe deliberately does not
// dedupe it. Crash after `refunds.create()` resolves but before `finish_payment_job` commits, and
// the customer is refunded twice.
//
// THE FIX, both halves:
//   1. A **stable** idempotency key for refunds — `refund:job:<id>`, with no attempt number. Stripe
//      honours an idempotency key for 24 h and replays the original response, so the retry of a call
//      that did reach Stripe returns the same refund instead of making a second one. This is the
//      part that closes the race, because it needs no state of our own.
//   2. A **belt-and-braces** pre-check: list the refunds already on the PaymentIntent and look for
//      one tagged `metadata.job_id = <this job>`. This is the same "ask Stripe what is true" shape
//      capture/void use, and it still works if the 24 h idempotency window has passed (a job stuck
//      in `processing` over a long outage) — the one case a key alone would not cover.
//
// This file is pure so the crash-then-reclaim sequence can be tested without Stripe: the test runs
// planRefund, simulates the refund landing at Stripe, and runs it again at the next attempt.

export type RefundJob = { id: string; order_id: string; amount_cents: number | null; attempts: number };
export type RefundIntentView = { status: string; amount_received: number | null };
export type ExistingRefund = { id: string; amount: number; status: string; metadata?: Record<string, string> | null };

export type RefundPlan =
  | { kind: "already"; refund_id: string; amount: number; status: string }
  | { kind: "create"; amount: number; idempotencyKey: string }
  | { kind: "error"; final: boolean; error: string };

/** Stable across retries on purpose — see (1) above. Never include `attempts`. */
export function refundIdempotencyKey(jobId: string): string {
  return `refund:job:${jobId}`;
}

/** A refund this exact job already created, if Stripe has one. Ignores refunds from other jobs. */
export function findRefundForJob(refunds: ExistingRefund[], jobId: string): ExistingRefund | undefined {
  return refunds.find((r) => r.metadata?.job_id === jobId && r.status !== "failed" && r.status !== "canceled");
}

export function planRefund(
  job: RefundJob,
  pi: RefundIntentView,
  order: { payment_refunded_cents: number },
  existingRefunds: ExistingRefund[],
): RefundPlan {
  // Whatever else is true, a refund this job already made is done — report it, do not repeat it.
  const mine = findRefundForJob(existingRefunds, job.id);
  if (mine) return { kind: "already", refund_id: mine.id, amount: mine.amount, status: mine.status };

  if (pi.status !== "succeeded") {
    return { kind: "error", final: pi.status === "canceled", error: `cannot refund: intent is ${pi.status}` };
  }
  const remaining = (pi.amount_received ?? 0) - order.payment_refunded_cents;
  const amount = job.amount_cents ?? remaining;
  if (amount <= 0 || amount > remaining) {
    return { kind: "error", final: true, error: `refund amount ${amount} outside 1..${remaining}` };
  }
  return { kind: "create", amount, idempotencyKey: refundIdempotencyKey(job.id) };
}
