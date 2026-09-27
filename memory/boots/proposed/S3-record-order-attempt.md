# Proposal (for S3): call `record_order_attempt` so the funnel has data

Written by S2 in S2-03 (2026-09-27) because the dependency runs the other way for once: the table and
the RPC are live, and **nothing writes to them until the guest site does**. Not executed by S2 — this
is S3's call to make (its own boot, probably S3-03). S0 decides when.

## What exists now (S2-03, PR #34)
`order_attempts` + `rpc('record_order_attempt', { payload })` — api-contracts §1.7. Anon-callable,
rate-limited per `session_hash`, PII-free by construction (a CHECK constraint, not a convention).
`owner`/`operator` read it; `anon` cannot select it at all.

## What S3 needs to do — two call sites, both one call
1. **A rejected `place_order`.** The RPC already hands back everything needed: the error's `details`
   is the `problems[]` array and its `hint` now names this RPC. `place_order` cannot write the row
   itself — PostgREST runs one transaction per request and the rejection is a `raise`, so any row it
   inserted would roll back with it (§6.9 row 5 records this).
   ```ts
   const { error } = await supabase.rpc('place_order', { payload });
   if (error?.message === 'order_rejected') {
     await supabase.rpc('record_order_attempt', {
       payload: { type, session_hash, postal_code, subtotal_cents,
                  items: cart.map(l => ({ item_id: l.item_id, qty: l.qty })),
                  problems: JSON.parse(error.details), promo_code },
     });
   }
   ```
2. **Abandonment at a `problems[]` state** — the guest sees "sold out" / "outside the delivery area"
   in the cart and leaves. Fire once per problem state, not per `quote_order` call: `quote_order`
   runs on every cart change, and 20 rows per session per minute is the rate-limit ceiling.
   Debounce, and skip if the same `problems[]` codes were already recorded for this session.

## `session_hash` — what it must and must not be
An opaque id in **`sessionStorage`** (`crypto.randomUUID()` on first use), not a cookie, not
`localStorage`, not derived from anything about the person. No consent banner is involved because it
is not a tracking identifier: it exists only so the DB can de-duplicate and rate-limit, and it dies
with the tab. Never pass a phone hash, a customer id or a device fingerprint.

Nothing else may travel: no name, phone, email, street, comment. The RPC drops unknown keys and the
CHECK constraint rejects anything but `{item_id, qty}` in `items`, so a mistake fails loudly rather
than leaking — but do not rely on that, send only what the payload above lists.

## What it unblocks
The Berichte funnel (§6.10). Until S3 emits rows, `report_funnel.attempts`,
`attempts_with_problems` and `attempts_to_placed_pct` read `0` / `null` — the query is real, the data
is not. `placed`, `paid` and the ZUSATZVERKAUF figures are already honest and need nothing from S3.
It also lights up the two BO · Zustände states S4 could not render in S4-01 (contract request 5):
*"sold out during checkout"* and *"address outside the delivery area"*.

**MENÜ → WARENKORB still cannot be computed** from this — it needs menu impressions / add-to-cart
events, which is the separate `site_events` decision in `S2-03-reports-campaigns-cms.md` §1 and needs
S0 to rule on it (GDPR) first.
