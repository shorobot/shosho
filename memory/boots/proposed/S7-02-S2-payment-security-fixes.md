# Proposal → S2 Backend: payment security fixes from the S7-01 audit

From S7 Security. **Top item is CRITICAL and money-relevant** — recommend the owner prioritises this
boot before any real Stripe account/live payment happens. Full context: `/docs/security.md` §5,
`/memory/log.md` S7-01 entry. S7 did not fix any of this itself: it is a contract-level behaviour
change to functions S2 owns and tests extensively (`place_order`, `set_order_status`), not a small
additive migration.

## Task 1 (CRITICAL) — stop trusting client-supplied `payment_status` in `place_order`

**Where:** `apps/backend/supabase/migrations/20260920000010_rpc.sql:435-442` (accepts
`payload->>'payment_status'` as `pending`/`authorized` with no check against `payment_method`),
`:506` (written straight onto the new order), `:533-547` (auto-accept fires off this client value),
and `20260921000015_set_order_status_payments.sql:110-116` (the "v1 client-reported payment" branch:
on `delivered`/`picked_up`, any order with `payment_provider is null` and `payment_method <> 'cash'`
is marked `paid` purely because `payment_status` was already `pending`/`authorized` — it never checks
whether a real payment ever happened).

**Exploit:** `rpc('place_order', { ..., payment_method: 'card', payment_status: 'authorized' })` as
`anon` (the public, unauthenticated web caller) creates an order that (a) writes a false
`payment_authorized` event, (b) may auto-accept straight into the kitchen queue if under
`auto_accept_paid_under_cents`, and (c) is marked `paid` the moment staff mark it delivered — with
`create-payment-intent` never called and no Stripe interaction at any point. This is a "free order"
vector for every non-cash payment method, live today on `shosho-staging` and not specific to a
pre-Stripe v1 window — it is exercised by a currently-passing test,
`apps/backend/tests/place_order.test.ts:117-124`.

**Why S2, not S7:** this is the RPC's core trust boundary and a documented contract behaviour
(`docs/api-contracts.md` §5.3 "v1: what the payment step reported" / §5.6 tells the *client* not to
report `authorized` any more, but nothing enforces that server-side). Fixing it changes
`place_order`'s and `set_order_status`'s behaviour and will need `place_order.test.ts:117-124`
rewritten to match — that's squarely S2's function and S2's test file.

**Recommended fix (S7's read; S2 may find a cleaner shape):**
- `place_order`: for any `payment_method` in `('card','apple_pay','google_pay','paypal')`, ignore
  client-supplied `payment_status` entirely and always insert `pending` — authorization can only
  legitimately come from the `stripe-webhook` (already true since S2-02: "the auto-accept rule now
  fires here" in `record_payment_event`, per the S2-02 log entry). The client-trust path in
  `place_order` (lines 435-442, 533-547) is now dead-but-dangerous v1 code that S2-02 was supposed to
  supersede, not layer on top of.
- Consider whether `payment_method: 'cash'` should keep accepting `pending` only (it already does —
  no change needed there, `set_order_status`'s cash branch is unaffected and correctly gated on
  `cash_received`).
- `set_order_status`'s final `else` branch (`20260921000015...:110-116`) should not be reachable at
  all for `payment_method` values that go through Stripe once (1) is fixed — audit whether it's still
  needed for any legitimate case (a payment method with literally no provider), or whether it should
  be removed now that Stripe covers card/apple_pay/google_pay/paypal.
- Update `api-contracts.md` §5.3/§5.6 to match (propose the wording to S0 — S2 doesn't edit that file
  directly per D-002/D-003, but should draft the diff since it best understands the change).
- Update `place_order.test.ts:117-124` to assert the *new* (safe) behaviour instead of the client-trust
  one it currently locks in.

## Task 2 (Medium/High) — `payment-worker` can duplicate a refund on crash-then-reclaim

**Where:** `apps/backend/supabase/functions/payment-worker/index.ts:33,52-58`.

Unlike `capture`/`void` (which re-check the PaymentIntent's own live Stripe status — `succeeded`/
`canceled` — as an authoritative "already done" guard before acting), the `refund` case has no
equivalent check against Stripe for "has this specific refund already happened." Its only defence is
`orders.payment_refunded_cents`, updated only by the `charge.refunded` webhook — not by this job
itself. If the worker process dies after `stripe.refunds.create()` succeeds but before
`finish_payment_job` persists the outcome, the job is reclaimed after 10 minutes with a new
idempotency key (`job:<id>:<attempt+1>`), and Stripe will not dedupe the retried call.

**Suggested fix:** before calling `stripe.refunds.create`, list existing refunds on the PaymentIntent
and check for one already tagged `metadata.job_id = job.id` (mirroring the "check live Stripe state
first" pattern `capture`/`void` already use), or persist "Stripe call attempted" state transactionally
before making the call rather than after.

## Task 3 (Low) — `payment-worker` has no service-role check of its own

**Where:** `apps/backend/supabase/functions/payment-worker/index.ts` (whole file);
`apps/backend/supabase/config.toml:400-403` (`verify_jwt = true`).

`verify_jwt = true` only requires *some* valid project JWT — the public anon key qualifies. Anyone can
invoke `POST /functions/v1/payment-worker` (including `{"action":"install"}`, which re-runs
`schedule_payment_worker` — harmless since its params are hardcoded server-side, not attacker-supplied,
but still an unnecessarily wide surface). This is a known, commented, deliberate tradeoff (cron calls
it via a Vault-stored anon key) — flagging so S2 can decide whether to add an explicit
`is_service_request()`-style check or accept the tradeoff as documented. **Note:** S1 independently
flagged the exact same issue in the S1-04 log entry (2026-09-26, "Not mine to fix, flagging to
S7/S2") while reviewing the functions-deploy pipeline — two independent reviews landing on the same
finding; S1 deliberately left the workflow's own install POST on the anon key ("that is how pg_cron
invokes it, and swapping in the service-role key would hide the problem rather than fix it"), which
S7 agrees with — the fix belongs inside the function, not in how the workflow calls it.

## Task 4 (Low) — non-constant-time `tracking_token` comparison

**Where:** `apps/backend/supabase/functions/create-payment-intent/index.ts:57`:
`body.tracking_token !== order.tracking_token`. Low practical risk given 128 bits of token entropy,
but every other secret-comparison in this codebase (`_shared/stripe-signature.ts`'s
`timingSafeEqualHex`) is deliberately constant-time — suggest the same helper here for consistency.

## Task 5 (Low, hygiene) — pin `search_path` on the remaining `SECURITY INVOKER` functions

`set_updated_at`, `current_actor`, `orders_before_status_change`, `settings_public_keys`,
`normalize_phone`, `order_transition_allowed` don't pin `search_path`. Not an active
privilege-escalation vector (invoker functions run with the caller's privileges), but inconsistent
with every `SECURITY DEFINER` function in the schema. Whenever one of these is next touched, add
`set search_path = public` (or `pg_catalog, public` for the ones needing system catalogs).

## Task 6 (process) — HTTP-layer tests for the Edge Functions

None of `webhook.test.ts`/`payment_jobs.test.ts` actually exercise the deployed `Deno.serve` handlers
over HTTP — they call the shared pure helpers (`verifyStripeSignature`, `toRecordPaymentEventArgs`)
and the underlying RPCs directly. A regression in the HTTP-layer logic itself (method checks, the
`503`/`401` fail-closed paths, response shapes) would not be caught today. Consider a `supabase
functions serve` + fetch-based test tier if S2's CI environment can support it (needs Docker, which
this Mac doesn't have — the same constraint S2-01/S2-02 already worked around by relying on the
`backend` CI job's ubuntu runner).
