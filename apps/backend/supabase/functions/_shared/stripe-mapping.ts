// Pure helpers shared by the Edge Functions and unit-tested in vitest (tests/webhook.test.ts).
// Maps Stripe objects onto the SHOSHO schema — no I/O here.

/** Event types the webhook applies; everything else is logged into payment_events only. */
export const HANDLED_EVENTS = [
  "payment_intent.amount_capturable_updated",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export type ShoshoPaymentMethod = "card" | "apple_pay" | "google_pay" | "paypal" | "bitcoin" | "cash";

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> & { id?: string; object?: string; metadata?: Record<string, string> } };
}

export interface RecordPaymentEventArgs {
  p_provider: "stripe";
  p_event_id: string;
  p_type: string;
  p_payload: StripeEventLike;
  p_payment_intent_id: string | null;
  p_order_id: string | null;
  p_payment_ref: string | null;
  p_payment_method: ShoshoPaymentMethod | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PaymentIntent id carried by the event: the object itself (payment_intent.*) or charge.payment_intent. */
export function paymentIntentIdOf(ev: StripeEventLike): string | null {
  const o = ev.data.object;
  if (o.object === "payment_intent" && typeof o.id === "string") return o.id;
  const pi = o.payment_intent;
  if (typeof pi === "string") return pi;
  if (pi && typeof pi === "object" && typeof (pi as { id?: unknown }).id === "string") return (pi as { id: string }).id;
  return null;
}

export function orderIdOf(ev: StripeEventLike): string | null {
  const id = ev.data.object.metadata?.order_id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

export function isHandled(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

/** The PaymentMethod id to look up for a human-readable payment_ref (authorization only). */
export function paymentMethodIdOf(ev: StripeEventLike): string | null {
  if (ev.type !== "payment_intent.amount_capturable_updated") return null;
  const pm = ev.data.object.payment_method;
  if (typeof pm === "string") return pm;
  if (pm && typeof pm === "object" && typeof (pm as { id?: unknown }).id === "string") return (pm as { id: string }).id;
  return null;
}

const BRANDS: Record<string, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", diners: "Diners",
  jcb: "JCB", unionpay: "UnionPay", cartes_bancaires: "CB", eftpos_au: "eftpos",
};

export interface PaymentMethodLike {
  type: string;
  card?: { brand?: string; last4?: string; wallet?: { type?: string } | null } | null;
  paypal?: Record<string, unknown> | null;
}

/** "Visa ···4242" / "Apple Pay ···4242" / "PayPal" and the payment_method enum value. */
export function describePaymentMethod(pm: PaymentMethodLike | null | undefined): { ref: string | null; method: ShoshoPaymentMethod | null } {
  if (!pm) return { ref: null, method: null };
  if (pm.type === "paypal") return { ref: "PayPal", method: "paypal" };
  if (pm.type === "card" && pm.card) {
    const wallet = pm.card.wallet?.type;
    const brand = BRANDS[pm.card.brand ?? ""] ?? (pm.card.brand ? pm.card.brand[0].toUpperCase() + pm.card.brand.slice(1) : "Card");
    const tail = pm.card.last4 ? ` ···${pm.card.last4}` : "";
    if (wallet === "apple_pay") return { ref: `Apple Pay${tail}`, method: "apple_pay" };
    if (wallet === "google_pay") return { ref: `Google Pay${tail}`, method: "google_pay" };
    return { ref: `${brand}${tail}`, method: "card" };
  }
  return { ref: pm.type, method: "card" };
}

/** Arguments for rpc('record_payment_event') from a verified event (+ the resolved PaymentMethod, if any). */
export function toRecordPaymentEventArgs(ev: StripeEventLike, pm?: PaymentMethodLike | null): RecordPaymentEventArgs {
  const { ref, method } = describePaymentMethod(pm);
  return {
    p_provider: "stripe",
    p_event_id: ev.id,
    p_type: ev.type,
    p_payload: ev,
    p_payment_intent_id: paymentIntentIdOf(ev),
    p_order_id: orderIdOf(ev),
    p_payment_ref: ref,
    p_payment_method: method,
  };
}
