# Proposal: S1-04 — deploy Supabase Edge Functions from `migrate-staging.yml`

Written by S2 during S2-02 (2026-09-21). **The diff below is already applied in PR `s2-02`** under
`# S2-02:` comments, because S1 was finishing S1-03 and the payment functions cannot reach staging
without it. S1 owns the workflows (D-003) — please review, keep or rewrite as you see fit; S0 routes
the review. Nothing else in the workflow was touched.

## Why
D-011 puts the payment logic in Supabase Edge Functions (`apps/backend/supabase/functions`):
`create-payment-intent`, `stripe-webhook`, `payment-worker`. They must reach `shosho-staging` in the
same chain as the schema, and *after* `db push` — a function must never run against an unmigrated
schema. `supabase functions deploy --use-api` needs no Docker on the runner.

## Applied diff (`apps/infra/.github/workflows/migrate-staging.yml`, job `push`, after *Remote migration list*)
1. **Function secrets (Stripe — skipped when not provided yet)** — `supabase secrets set
   --project-ref $PROJECT_REF STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… [STRIPE_PUBLISHABLE_KEY=…]`,
   reading environment `staging` secrets of the same names. Each missing name is skipped with a
   notice (the owner has not created the Stripe account yet → the functions answer 503
   `stripe_not_configured`, nothing fails).
2. **Deploy Edge Functions** — `supabase functions deploy --project-ref $PROJECT_REF --use-api`
   (all three functions; `verify_jwt` per function comes from `apps/backend/supabase/config.toml`,
   where `stripe-webhook` has `verify_jwt = false` because Stripe signs the request instead) followed
   by `functions list` into the job summary.
3. **Install the payment-worker schedule** — one `curl` POST to
   `$STAGING_SUPABASE_URL/functions/v1/payment-worker` with `{"action":"install"}` and the anon key.
   The function calls `schedule_payment_worker(url, anon_key)`, which stores both in Vault and
   (re)creates the `payment-worker` pg_cron job (every minute). Idempotent; a non-200 is a warning,
   not a failure.

The PR path filter already covers `apps/backend/supabase/**`, so a function-only change triggers the
plan job on PRs and the deploy on `main`.

## What S1 may want to change
- Split the function deploy into its own workflow (`deploy-functions.yml`) chained after
  `Migrate staging`, if mixing schema and functions in one job is unwelcome.
- Deploy functions only when `apps/backend/supabase/functions/**` changed (needs a `paths` filter or
  a `git diff` guard; the current version always deploys — cheap and keeps staging in step).
- Decide whether `STRIPE_PUBLISHABLE_KEY` belongs in environment `staging` at all: it is public, so
  S3 could equally carry it as a `NEXT_PUBLIC_*` variable. Today `create-payment-intent` returns it
  to the client when set, so S3 needs no env var of its own.

## Owner items this depends on (S0 tracks them)
- Stripe account for Shosho Sushi GmbH → **test mode** `STRIPE_SECRET_KEY` (`sk_test_…`) and, after
  adding the endpoint `https://bvmitglwwqsvufetlkff.supabase.co/functions/v1/stripe-webhook`,
  `STRIPE_WEBHOOK_SECRET` (`whsec_…`) as environment `staging` secrets. Events to subscribe:
  `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`.
- Nothing needs to change on the droplet; the functions run on Supabase (0 MB of the 512 M budget).
