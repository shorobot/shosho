// [S2-02] create-payment-intent — api-contracts §5.6
// POST { order_id, tracking_token? }  (anon: tracking_token required; staff session: not required)
// → { client_secret, payment_intent_id, amount_cents, currency, publishable_key, publishable_key_name }
//
// Creates (or reuses) a Stripe PaymentIntent for the order: amount = orders.total_cents, EUR,
// capture_method = manual (D-011: captured on delivered / picked_up by payment-worker),
// automatic_payment_methods on (cards, Apple Pay, Google Pay, PayPal — as enabled in the Stripe
// dashboard). Writes orders.payment_intent_id / payment_provider = 'stripe' through the
// service-role client. Secrets: STRIPE_SECRET_KEY (required), STRIPE_PUBLISHABLE_KEY (optional,
// returned to the client so the web app does not need its own env var).
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { json, problem, CORS } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_PUBLISHABLE_KEY = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? null;

const EDITABLE = new Set(["new", "accepted", "preparing"]);
const REUSABLE_PI = new Set(["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return problem("method_not_allowed", 405);
  if (!STRIPE_SECRET_KEY) return problem("stripe_not_configured", 503, { hint: "set function secret STRIPE_SECRET_KEY" });

  let body: { order_id?: string; tracking_token?: string };
  try {
    body = await req.json();
  } catch {
    return problem("invalid_json");
  }
  if (!body.order_id) return problem("invalid_input", 400, { field: "order_id" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Who is calling? Staff (owner/operator) may create intents for phone orders without the token.
  let staff = false;
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const caller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: role } = await caller.rpc("auth_role");
    staff = role === "owner" || role === "operator";
  }

  const { data: order, error } = await admin
    .from("orders")
    .select("id, number, status, payment_status, payment_method, payment_provider, payment_intent_id, total_cents, tracking_token, contact_name")
    .eq("id", body.order_id)
    .maybeSingle();
  if (error) return problem("db_error", 500, { message: error.message });
  if (!order) return problem("order_not_found", 404);
  if (!staff && (!body.tracking_token || body.tracking_token !== order.tracking_token)) return problem("forbidden", 403);
  if (!EDITABLE.has(order.status)) return problem("order_not_payable", 409, { status: order.status });
  if (order.payment_method === "cash") return problem("cash_order", 409);
  if (order.payment_status === "paid" || order.payment_status === "refunded") return problem("already_paid", 409);
  if (order.total_cents <= 0) return problem("zero_amount", 409);

  const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

  // Reuse an open intent (customer reloaded the checkout); keep its amount in step with the order.
  let pi: Stripe.PaymentIntent | null = null;
  if (order.payment_intent_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.payment_intent_id);
      if (REUSABLE_PI.has(existing.status)) {
        pi = existing;
        if (existing.amount !== order.total_cents && existing.status !== "requires_capture" && existing.status !== "processing") {
          pi = await stripe.paymentIntents.update(existing.id, { amount: order.total_cents });
        }
      }
    } catch (e) {
      console.warn("retrieve existing intent failed", (e as Error).message);
    }
  }

  if (!pi) {
    try {
      pi = await stripe.paymentIntents.create(
        {
          amount: order.total_cents,
          currency: "eur",
          capture_method: "manual",
          automatic_payment_methods: { enabled: true },
          description: `SHOSHO order #${order.number}`,
          metadata: { order_id: order.id, order_number: String(order.number) },
        },
        { idempotencyKey: `order:${order.id}:${order.payment_intent_id ?? "first"}:${order.total_cents}` },
      );
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      return problem("stripe_error", 502, { message: err.message, code: err.code ?? null });
    }
    const { error: upd } = await admin
      .from("orders")
      .update({ payment_intent_id: pi.id, payment_provider: "stripe" })
      .eq("id", order.id);
    if (upd) return problem("db_error", 500, { message: upd.message });
  }

  return json({
    client_secret: pi.client_secret,
    payment_intent_id: pi.id,
    amount_cents: pi.amount,
    currency: pi.currency,
    publishable_key: STRIPE_PUBLISHABLE_KEY,
    publishable_key_name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  });
});
