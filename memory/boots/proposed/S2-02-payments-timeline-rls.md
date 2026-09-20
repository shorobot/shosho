# Proposal: S2-02 — payments capture, customer timeline, guest realtime, anonymisation

Proposed by S2 after S2-01 (2026-09-20). Not executed. S0 decides scope and order.

## Backend (S2-02)
1. **Payment capture** — replace the v1 stub (`delivered`/`picked_up` → `paid`) with real provider flow: `orders.payment_provider`, `payment_intent_id`; `authorize` at checkout (Stripe PaymentIntent, manual capture), capture on completion, void on cancel, refund on `refunded`. Webhook receiver = FastAPI (S5) or Supabase edge function — decide with S1/S5. Cash: driver confirmation (`set_order_status(delivered, {cash_received: true})`).
2. **Guest realtime** (§3): token-scoped RLS on `orders`/`order_events` (`tracking_token` from a request header / JWT claim) so the tracking page can subscribe instead of polling `get_order_by_token`.
3. **`customer_events`** (§1.3) + trigger `orders` → `customer_events(order)`; `set_order_status` payload `note` → customer timeline; complaint / compensation types for S4.
4. **Anonymisation job**: `anonymise_silent_customers(months int default 24)` — scrubs name/phone/email/addresses, sets `anonymised_at`, keeps order totals (GoBD). Scheduled by pg_cron (if enabled on the plan) or S5 cron.
5. **Storage**: bucket `menu` (public read, owner/operator write) for `menu_items.photos`; policy migration.
6. **Operator order edits**: `update_order_items(order_id, items)` RPC → `item_changed` events, re-totals, `modified_by_operator`.
7. **Reports views** for S4 Berichte (revenue by day / type, top items, funnel needs S3 events table — separate proposal).

## For other sessions
- **S1**: create `shosho-staging` (eu-central-1), add `STAGING_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY` + DB password as `STAGING_SUPABASE_DB_PASSWORD`; then a `deploy-staging` step `supabase db push --include-seed` (or S2 runs it once manually — needs the ref + password from the owner). Consider `supabase/setup-cli` caching to cut the ~1 min image pull in the `backend` CI job.
- **S3**: everything needed is in api-contracts §5. Note: test/staging opening hours are the real ones — outside 11–23 `quote_order` returns `closed/outside_hours` (pre-orders only), by design.
- **S4**: `set_order_status` returns the full order row; subscribe to `orders`, `order_items`, `order_events` (realtime publication exists). Kitchen board = kitchen role (read all orders, `preparing`/`ready` only).
- **S7**: rotate the four seed staff passwords on staging before real data; review `security definer` RPCs (`search_path` pinned to `public`).
