# S3 usage notes for api-contracts §5 — proposal (written by S3 during S3-01, 2026-09-21)

S0 decides whether to fold these into §5 ("S3 usage notes") and/or issue S2 changes. None of them blocked S3-01;
the site works around each one today.

## Gaps found while building the guest site

1. **No `slug` on `menu_items`.** The design has product URLs; the site derives `/menu/<slugify(name_en)>-<sku>` and
   resolves by the SKU suffix (`apps/web/lib/slug.ts`). Proposal (S2-02): `menu_items.slug text unique` maintained by
   the back-office item editor; S3 switches in one place.
2. **Private `ops` values the storefront shows.** Pickup card "−10 %", "ready in 22 min", "pre-orders up to 7 days":
   `settings.ops` is not in `settings_public_keys()`. Today the site derives −10 % and the minutes from a second
   `quote_order` with `type: 'pickup'` (server numbers, no client math) and hard-codes the 7-day hint in copy
   (server still validates `slot_too_far`). Proposal: add a public `ops.public` row (`pickup_discount_pct`,
   `prep_default_min`, `preorder_max_days`, `rush` bool) written by the same trigger pattern as `kitchen.status`.
3. **No item-level discount.** The design badge "−15 %" (set of the week) has no source: prices are `base_price_cents`
   only, discounts exist as promo codes. S3 shows BESTSELLER (`tags: hit`) and NEW (`tags: new`) and no −15 %.
   Proposal: `banners` (S2-02/S4) carry the promo; a `menu_items.compare_at_cents null` would let the card show
   a struck-through price without inventing math.
4. **No rating / orders-per-month.** "★ 4.9 · 312 orders this month" on the product page has no data; S3 omits it.
   Could come from a `menu_item_stats` view (count of `order_items` in the last 30 days) if wanted.
5. **`quote_order` for a single line.** The product page prices its "Add to order" button with
   `quote_order({type:'pickup', items:[one line]})` and reads `lines[0].line_total_cents`. Works, but every
   option toggle is an RPC round-trip (debounced 250 ms). A pure `price_line(item_id, option_ids[], qty)` would be
   lighter — optional.
6. **`get_order_by_token` ETA for delivered/cancelled orders is `null`** (documented) — the tracking page shows the
   `completed_at` / `cancelled_at` stamp instead. Fine; noting for S4/S6 tests.
7. **Anon key at runtime.** `NEXT_PUBLIC_*` values are inlined at build time in Next.js, but the image is built in
   CI without secrets; S3 reads env at request time on the server and injects it into the page
   (`window.__SHOSHO_ENV__`). Infra note for S1: the web container needs `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SITE_URL` (added to `_deploy.yml` + staging compose in S3-01).
8. **Photos.** `photos[]` are storage paths for a bucket that doesn't exist yet; the site accepts absolute URLs and
   falls back to placeholder art. When S2-02 creates the public `menu` bucket, S3 needs its public base URL
   (`<SUPABASE_URL>/storage/v1/object/public/menu/<path>`) — one line in `components/ui/Photo.tsx`.
