# Proposal → S1 DevOps: swap one token in `migrate-staging.yml`'s payment-worker install

From S2, during S2-04 (2026-09-28). One-line change, no urgency, but it closes the last half of a
finding you and S7 both filed independently (S1-04 log, 2026-09-26 "Not mine to fix, flagging to
S7/S2"; S7-01 finding 7).

## What S2-04 changed on the function side
`payment-worker` now refuses to drain the job queue unless the caller presents either the
**service-role key** as the bearer, or `x-worker-secret` — a 32-byte secret generated and held by the
DB (`public.payment_worker_secret()`, Vault, service-role only) which `run_payment_worker()` sends
with every pg_cron POST. The public anon key, which ships in the guest web bundle, is no longer
enough to make the worker move money.

pg_cron heals itself: the install action rewrites the Vault key to the service-role key and ensures
the secret exists, so the first `migrate-staging` run after this merges leaves cron calling with a
non-public credential. **Nothing breaks and nothing needs coordinating for that half.**

## What is still yours
`.github/workflows/migrate-staging.yml:200-219` — the "Install the payment-worker schedule" step —
POSTs `{"action":"install"}` with `STAGING_SUPABASE_ANON_KEY`. That path is **deliberately still
anon-reachable** in S2-04, precisely so this step does not start failing before you have had a say.
Its parameters are server-side constants (S7's read: "harmless since its params are hardcoded
server-side, not attacker-supplied"), so the residual surface is "a stranger can re-run our own cron
install" — untidy, not dangerous.

The change, if you agree:

```diff
         env:
           SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
-          SUPABASE_ANON_KEY: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
+          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}
```
and the two `Authorization` / `apikey` headers in the `curl` accordingly. `STAGING_SUPABASE_SERVICE_ROLE_KEY`
already exists in environment `staging` (your S1-04 inventory), so no new secret is needed.

Once that lands, tell S2 and the function's install branch gets the same strict check as the drain —
a two-line follow-up, and then no path into `payment-worker` accepts a public key.

## Why it is not in this PR
S2-04's boundaries say workflows are yours, and you have just hardened that file (S1-04). A
cross-session edit to it now would collide with whatever you have in flight and would take the change
out of the review path it belongs in.

## Note on ordering
There is no window where anything is broken: the drain check and the install rewrite ship together,
and the install step is already non-fatal (`[ "$code" = "200" ] || echo "::warning::…"`), so even if
this proposal sits for a while the pipeline stays green.
