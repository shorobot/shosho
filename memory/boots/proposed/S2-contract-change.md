# S2-01 — deviations / additions to api-contracts §1–4 (for S0 to reconcile)

Written by S2 during S2-01. Everything below is implemented as described; S0 decides whether to fold it into §1–4 or ask for a change.

## Additions (columns / keys not in the contract)
1. **`orders.tracking_token text unique`** (default 16 random bytes hex). §2 returns `tracking_token` from `place_order` and `get_order_by_token(token)` needs a lookup column; §1.4 did not list it.
2. **`delivery_zones.free_delivery_over_cents int null`** (seed: 3500 in every zone). The boot says "free delivery over the zone threshold"; §1.1 had no such column. Null = never free.
3. **`settings.ops.pickup_discount_pct`** (10) — the −10 % pickup rule as a setting instead of a constant.
4. **`settings.kitchen.rush bool`** — the "+15 min rush" toggle from the orders board; read by `quote_order` and `set_order_status(preparing)`.
5. **`settings.kitchen.status`** public row `{paused, since}` written by `kitchen_pause()` — the guest site needs "paused / sold out today" without exposing `kitchen.paused_by`. Added to the public allow-list next to `payments.enabled`.
6. **`settings.payments.enabled`** is a separate row from `settings.payments` (private provider/payout config) — the allow-list in the boot names `payments.enabled`, so the public projection lives in its own row.
7. **`order_events.type = 'picked_up'`** for the pickup completion (contract list had `delivered` only).
8. `quote_order` problem codes beyond the five in §2: `invalid_options` (option not linked / inactive / group min-max violated), `empty_cart`, `invalid_input` (bad type / item id / contact / payment_method). `closed` and `unavailable` carry a `reason` field.
9. `place_order` payload accepts `payment_status` (`pending` | `authorized`, default `pending`) and `payment_ref` — per the boot ("payment_status stays pending/authorized by RPC input in v1"). Staff callers may also pass `channel` (phone orders); guests are forced to `website`.
10. `place_order` returns `status` in addition to `{order_id, number, total_cents, tracking_token}` (auto-accept can make it `accepted` immediately).
11. `set_order_status` returns the full updated `orders` row (jsonb) — S4 needs it for the board.

## Interpretations of §4 (role matrix)
- Public data (`menu_*`, active `delivery_zones`, public `settings` keys) is readable by **all** authenticated staff, including `driver` (matrix said "none" for driver — a logged-in driver seeing what anon sees is harmless and the driver app needs the business address).
- `kitchen` and `driver` can read **their own** `staff` row (matrix: "none") — any UI needs "who am I". `auth_role()` is security definer and does not depend on this.
- `kitchen` has no direct UPDATE on `orders`; `preparing`/`ready` go through `set_order_status`. Same for `driver` → `delivered`.
- `promo_codes`: owner + operator all, nobody else (validated for guests inside `quote_order`).

## v1 stubs S2-02 must replace
- Payment capture: `delivered`/`picked_up` sets `payment_status = 'paid'` when it was `pending`/`authorized`; `cancelled` resets `authorized` → `pending`. No provider calls.
- Guest realtime: `get_order_by_token` is polling-only; token-scoped RLS for realtime is S2-02 (§3).
- `customer_events`, anonymisation job — not built (S2-02).
