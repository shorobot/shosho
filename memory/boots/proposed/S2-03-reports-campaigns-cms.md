# Proposal: S2-03 — reports views, campaigns / automations, banners & site publish

Proposed by S2 after S2-02 (2026-09-26). Not executed. S0 decides scope and order. Everything here is
additive; nothing changes a shipped RPC signature.

## 1. Reports for Berichte (S4) — views only, no new writes
- `report_revenue_daily` — `day` (Europe/Berlin), `orders_count`, `revenue_cents`, `delivery_cents`,
  `pickup_cents`, `tip_cents`, `discount_cents`, `refunded_cents`, `avg_cents`, `cancelled_count`.
  Excludes `cancelled`; counts `refunded` separately so the sum row matches the bank.
- `report_top_items` — `item_id`, `sku`, `name_de/en`, `qty`, `revenue_cents`, `share_pct` over a period;
  a view over `order_items` + `orders` (period filtered client-side by `created_at`, or a function
  `report_top_items(from, to, limit)` if the filter should live server-side — S0 picks).
- `report_payments` — per `payment_method` / `payment_status`: count, cents, refunded cents (needs
  `payment_events` / `payment_jobs` from S2-02 for the provider trail).
- `report_kitchen` — median and p90 of `preparing_at → ready_at` and `ready_at → completed_at` per day,
  overdue count vs `promised_minutes`; the operator's "avg delivery" KPI comes from here.
- **Funnel** (menu → cart → paid) needs client events that do not exist. Proposal: a thin
  `site_events(session_id, type, payload, at)` table written by S3 (`page_view`, `add_to_cart`,
  `checkout_started`) with insert-only RLS for `anon`, plus a `report_funnel` view. That is a separate
  decision (GDPR: no IP, no user agent, cookie-less session id in `sessionStorage`, consent-free
  because it is strictly first-party aggregate) — S0 should rule on it before S2 builds it.
- All views `security_invoker`, so the existing staff RLS applies; `kitchen` / `driver` see nothing.

## 2. Campaigns & automations for Marketing (S4/S5)
- `campaigns` — `name`, `channel` (push/email/both), `segment jsonb` (the CRM filter as saved),
  `message_de/en jsonb` (title, body, deep_link), `status` (draft/scheduled/sending/sent/cancelled),
  `scheduled_for`, `sent_at`, `stats jsonb` (recipients, delivered, opened, orders, revenue_cents).
- `campaign_recipients` — `campaign_id`, `customer_id`, `state` (queued/sent/failed/opened),
  `sent_at`, `opened_at`, `error`; unique (campaign_id, customer_id). This is what makes
  "max one automated action per customer per week" (design rule) enforceable in SQL.
- `automations` — `kind` (welcome / win_back_45d / birthday / review_after_delivery), `active`,
  `config jsonb` (delay, message, discount), `last_run_at`; plus `automation_runs` for the audit.
- RPC `resolve_segment(segment jsonb)` → customer ids + consent counts, so the wizard's "recipients"
  number and the actual send use one implementation. Consent is mandatory: only customers with the
  matching `consent_*` row and not `anonymised_at`.
- Sending itself is S5 (Claude Agent SDK / FastAPI) — S2 delivers the tables, the segment resolver and
  a `claim_campaign_recipients(limit)` worker function shaped like `claim_payment_jobs`.

## 3. Banners & site publish for the CMS (S4)
- `banners` — `slot` (home_hero / home_strip / product / checkout), `image_path` (bucket `site`),
  `title_de/en`, `subtitle_de/en`, `cta_label_de/en`, `cta_href`, `valid_from/to`, `sort`, `active`.
  Public read of active + in-window rows for `anon` (a `banners_live` view).
- `site_publications` — `at`, `actor_id`, `summary jsonb` (what changed), `snapshot jsonb`. The CMS
  screen's "unpublished changes" counter needs a notion of draft vs live: proposal — `settings` and
  `banners` rows get `draft jsonb null`; `publish_site()` (owner) copies `draft` → `value` and writes a
  `site_publications` row; the guest site keeps reading `value` only. That is the smallest change that
  gives the design's publish flow without a second table per entity.
- New storage bucket `site` (public read, owner/operator write) for banner images, same policy shape as
  `menu` (S2-02 migration 12 is the template).

## 4. Small items carried over
- `menu_items.slug text unique` (S3 note 1) — S3 currently derives the URL from `name_en` + SKU.
- Public `ops.public` settings row (S3 note 2: `pickup_discount_pct`, `prep_default_min`,
  `preorder_max_days`, `rush`) written by a trigger like `kitchen.status`, so the storefront stops
  inferring them from a second quote.
- `menu_items.compare_at_cents null` (S3 note 3) for the design's struck-through "−15 %" price.
- `menu_item_stats` view (S3 note 4: 30-day order count) for the product page's "312 orders this month".
- On-request GDPR erasure for a single customer: `anonymise_customer(customer_id)` with an owner gate
  and a `customer_events(anonymised, reason: 'request')` entry — S2-02 only ships the nightly job.
- `receipts` bucket (private) for invoice PDFs when S5 Accounting needs it (skipped in S2-02).

## Dependencies
- Reports and CMS need no owner action. Campaigns need a push / email provider decision (D-0xx):
  web push (VAPID, free) vs a service; email via Resend / Postmark / SMTP. S0 + owner.
- The funnel needs the `site_events` decision above before S3 can emit anything.
