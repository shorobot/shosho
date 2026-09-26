// [S2-02] payment-worker — drains public.payment_jobs against Stripe (D-011).
// Invoked by: pg_cron every minute + the payment_jobs insert trigger (both via pg_net with the
// anon key from Vault — see migration 17), or by hand (`supabase functions invoke payment-worker`).
// verify_jwt stays on: the gateway wants a project JWT (anon is enough); the work itself uses the
// service role from the function environment. Every Stripe call carries an idempotency key
// `job:<id>:<attempt>` so a retried job can never capture / refund twice.
//
// POST {}                    → process up to 10 queued jobs, returns a summary
// POST {"action":"install"}  → schedule_payment_worker(<this function's URL>, anon key): writes the
//                              Vault secrets + (re)creates the cron job. Run once per environment
//                              by migrate-staging.yml after `functions deploy`.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { json, problem } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

type Job = {
  id: string;
  order_id: string;
  action: "capture" | "void" | "refund" | "update_amount";
  amount_cents: number | null;
  attempts: number;
};
type Outcome = { ok: boolean; final?: boolean; error?: string; result?: Record<string, unknown> };

async function runJob(stripe: Stripe, job: Job, order: { payment_intent_id: string | null; total_cents: number; payment_refunded_cents: number }): Promise<Outcome> {
  const piId = order.payment_intent_id;
  if (!piId) return { ok: false, final: true, error: "order has no payment_intent_id" };
  const idem = { idempotencyKey: `job:${job.id}:${job.attempts}` };

  const pi = await stripe.paymentIntents.retrieve(piId);

  switch (job.action) {
    case "capture": {
      if (pi.status === "succeeded") return { ok: true, result: { already: "captured", amount_received: pi.amount_received } };
      if (pi.status !== "requires_capture") return { ok: false, final: pi.status === "canceled", error: `cannot capture: intent is ${pi.status}` };
      const amount = Math.min(job.amount_cents ?? order.total_cents, pi.amount_capturable ?? pi.amount);
      if (amount <= 0) return { ok: false, final: true, error: "capture amount is 0" };
      const captured = await stripe.paymentIntents.capture(piId, { amount_to_capture: amount }, idem);
      return { ok: true, result: { status: captured.status, amount_received: captured.amount_received, latest_charge: captured.latest_charge } };
    }
    case "void": {
      if (pi.status === "canceled") return { ok: true, result: { already: "canceled" } };
      if (pi.status === "succeeded") return { ok: false, final: true, error: "already captured — refund instead" };
      const canceled = await stripe.paymentIntents.cancel(piId, { cancellation_reason: "requested_by_customer" }, idem);
      return { ok: true, result: { status: canceled.status } };
    }
    case "refund": {
      if (pi.status !== "succeeded") return { ok: false, final: pi.status === "canceled", error: `cannot refund: intent is ${pi.status}` };
      const remaining = (pi.amount_received ?? 0) - order.payment_refunded_cents;
      const amount = job.amount_cents ?? remaining;
      if (amount <= 0 || amount > remaining) return { ok: false, final: true, error: `refund amount ${amount} outside 1..${remaining}` };
      const refund = await stripe.refunds.create({ payment_intent: piId, amount, metadata: { order_id: job.order_id, job_id: job.id } }, idem);
      return { ok: true, result: { refund_id: refund.id, amount: refund.amount, status: refund.status } };
    }
    case "update_amount": {
      const amount = job.amount_cents ?? order.total_cents;
      if (pi.status === "requires_payment_method" || pi.status === "requires_confirmation" || pi.status === "requires_action") {
        const updated = await stripe.paymentIntents.update(piId, { amount }, idem);
        return { ok: true, result: { status: updated.status, amount: updated.amount } };
      }
      if (pi.status === "requires_capture") {
        if (amount <= pi.amount) return { ok: true, result: { note: "partial capture on completion", authorized: pi.amount, capture_amount: amount } };
        try {
          const inc = await stripe.paymentIntents.incrementAuthorization(piId, { amount }, idem);
          return { ok: true, result: { incremented_to: inc.amount } };
        } catch (e) {
          return { ok: false, final: true, error: `amount_exceeds_authorization: ${(e as Error).message}` };
        }
      }
      return { ok: false, final: true, error: `cannot update amount: intent is ${pi.status}` };
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return problem("method_not_allowed", 405);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body: { action?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  if (body.action === "install") {
    const { data, error } = await admin.rpc("schedule_payment_worker", {
      p_url: `${SUPABASE_URL}/functions/v1/payment-worker`,
      p_anon_key: ANON_KEY,
    });
    if (error) return problem("db_error", 500, { message: error.message });
    return json({ installed: true, ...data });
  }

  if (!STRIPE_SECRET_KEY) return problem("stripe_not_configured", 503, { hint: "set function secret STRIPE_SECRET_KEY" });
  const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

  const { data: jobs, error } = await admin.rpc("claim_payment_jobs", { p_limit: body.limit ?? 10 });
  if (error) return problem("db_error", 500, { message: error.message });

  const summary: Array<Record<string, unknown>> = [];
  for (const job of (jobs ?? []) as Job[]) {
    let outcome: Outcome;
    try {
      const { data: order, error: oerr } = await admin
        .from("orders")
        .select("payment_intent_id, total_cents, payment_refunded_cents")
        .eq("id", job.order_id)
        .single();
      if (oerr || !order) throw new Error(oerr?.message ?? "order not found");
      outcome = await runJob(stripe, job, order);
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      // Stripe "invalid request" answers do not change on retry.
      outcome = { ok: false, final: err?.type === "StripeInvalidRequestError", error: `${err?.code ?? err?.name ?? "error"}: ${err?.message ?? String(e)}` };
    }
    const { error: ferr } = await admin.rpc("finish_payment_job", {
      p_job_id: job.id,
      p_ok: outcome.ok,
      p_error: outcome.error ?? null,
      p_result: outcome.result ?? null,
      p_final: outcome.final ?? false,
    });
    summary.push({ job: job.id, action: job.action, order_id: job.order_id, ...outcome, finish_error: ferr?.message ?? null });
  }
  return json({ processed: summary.length, jobs: summary });
});
