// Recorded-shape Stripe test-mode events (trimmed to the fields our code reads), parameterised by
// the PaymentIntent id and the order id so every test gets fresh, unique event ids.
// Shapes follow the 2024-06-20+ API (no `charges` list on PaymentIntent; `latest_charge` id).

let seq = 0;
const evtId = (prefix: string) => `evt_test_${prefix}_${Date.now().toString(36)}_${(++seq).toString(36)}`;

export type Fixture = ReturnType<typeof amountCapturableUpdated>;

export function amountCapturableUpdated(pi: string, orderId: string, amount: number, pm = "pm_test_visa") {
  return {
    id: evtId("acu"),
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "payment_intent.amount_capturable_updated",
    data: {
      object: {
        id: pi,
        object: "payment_intent",
        amount,
        amount_capturable: amount,
        amount_received: 0,
        capture_method: "manual",
        currency: "eur",
        status: "requires_capture",
        payment_method: pm,
        latest_charge: `ch_${pi.slice(3)}`,
        metadata: { order_id: orderId },
      },
    },
  };
}

export function paymentFailed(pi: string, orderId: string, amount: number) {
  return {
    id: evtId("pf"),
    object: "event",
    type: "payment_intent.payment_failed",
    livemode: false,
    data: {
      object: {
        id: pi,
        object: "payment_intent",
        amount,
        currency: "eur",
        status: "requires_payment_method",
        last_payment_error: { code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." },
        metadata: { order_id: orderId },
      },
    },
  };
}

export function succeeded(pi: string, orderId: string, amount: number, received = amount) {
  return {
    id: evtId("ok"),
    object: "event",
    type: "payment_intent.succeeded",
    livemode: false,
    data: {
      object: {
        id: pi,
        object: "payment_intent",
        amount,
        amount_capturable: 0,
        amount_received: received,
        currency: "eur",
        status: "succeeded",
        latest_charge: `ch_${pi.slice(3)}`,
        metadata: { order_id: orderId },
      },
    },
  };
}

export function canceled(pi: string, orderId: string, amount: number) {
  return {
    id: evtId("cx"),
    object: "event",
    type: "payment_intent.canceled",
    livemode: false,
    data: {
      object: { id: pi, object: "payment_intent", amount, currency: "eur", status: "canceled", cancellation_reason: "requested_by_customer", metadata: { order_id: orderId } },
    },
  };
}

export function chargeRefunded(pi: string, orderId: string, amount: number, refunded: number) {
  return {
    id: evtId("rf"),
    object: "event",
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: `ch_${pi.slice(3)}`,
        object: "charge",
        amount,
        amount_captured: amount,
        amount_refunded: refunded,
        refunded: refunded >= amount,
        currency: "eur",
        payment_intent: pi,
        metadata: { order_id: orderId },
      },
    },
  };
}

export const visaPaymentMethod = {
  id: "pm_test_visa",
  object: "payment_method",
  type: "card",
  card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2034, wallet: null },
};
export const applePayPaymentMethod = {
  id: "pm_test_apple",
  object: "payment_method",
  type: "card",
  card: { brand: "mastercard", last4: "4444", wallet: { type: "apple_pay" } },
};
export const paypalPaymentMethod = { id: "pm_test_pp", object: "payment_method", type: "paypal", paypal: { payer_email: "x@example.com" } };
