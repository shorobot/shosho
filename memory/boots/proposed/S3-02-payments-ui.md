# Proposal — S3-02: payments UI (after S2-02)

Scope once S2-02 ships the payment provider (Stripe) and `payment_status: authorized`:
- Checkout step 3 becomes real: Stripe Payment Element for card / Apple Pay / Google Pay, PayPal button, Bitcoin
  (provider TBD), cash unchanged. `place_order` gets `payment_status: 'authorized'` + `payment_ref` only after the
  provider confirms; auto-accept (< 50 €) then applies.
- Tip presets from `settings.payments.enabled.tip_presets_cents` on the summary panel (`tip_cents` already flows).
- "Payment failed" state from the Zustände screen (retry / switch to cash).
- Tracking page shows `payment_authorized` / `paid` events.
Depends on: S2-02, secrets `STRIPE_PUBLISHABLE_KEY` (public) in `_deploy.yml`.
