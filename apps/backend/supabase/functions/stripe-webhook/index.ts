// [S2-02] stripe-webhook — D-011. Stripe → here (verify_jwt = false; the Stripe-Signature header is
// the authentication). Verifies the signature with STRIPE_WEBHOOK_SECRET, then hands the event to
// the SQL state machine `record_payment_event` (idempotent on event id) which updates the order,
// writes order_events and applies the auto-accept rule when the authorization arrives.
// Subscribed events (configure in the Stripe dashboard / `stripe listen --events`):
//   payment_intent.amount_capturable_updated, payment_intent.succeeded,
//   payment_intent.payment_failed, payment_intent.canceled, charge.refunded
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyStripeSignature } from "../_shared/stripe-signature.ts";
import { isHandled, paymentMethodIdOf, toRecordPaymentEventArgs, type PaymentMethodLike, type StripeEventLike } from "../_shared/stripe-mapping.ts";
import { json, problem } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return problem("method_not_allowed", 405);
  if (!STRIPE_WEBHOOK_SECRET) return problem("webhook_not_configured", 503, { hint: "set function secret STRIPE_WEBHOOK_SECRET" });

  const body = await req.text();
  const check = await verifyStripeSignature(body, req.headers.get("stripe-signature"), STRIPE_WEBHOOK_SECRET);
  if (!check.ok) return problem("invalid_signature", 400, { reason: check.reason });

  let ev: StripeEventLike;
  try {
    ev = JSON.parse(body);
  } catch {
    return problem("invalid_json");
  }
  if (!ev?.id || !ev?.type || !ev?.data?.object) return problem("invalid_event");

  // Resolve the PaymentMethod for a human-readable payment_ref ("Visa ···4242") on authorization.
  let pm: PaymentMethodLike | null = null;
  const pmId = paymentMethodIdOf(ev);
  if (pmId && STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
      pm = (await stripe.paymentMethods.retrieve(pmId)) as unknown as PaymentMethodLike;
    } catch (e) {
      console.warn("paymentMethods.retrieve failed", (e as Error).message);
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("record_payment_event", toRecordPaymentEventArgs(ev, pm));
  if (error) {
    console.error("record_payment_event", error);
    // 5xx → Stripe retries with backoff; the event id makes the retry idempotent.
    return problem("db_error", 500, { message: error.message });
  }
  return json({ received: true, handled: isHandled(ev.type), ...data });
});
