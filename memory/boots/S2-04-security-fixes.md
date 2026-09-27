# BOOT: S2-04 (Backend) — the S7-01 security findings that are yours, starting with the money one

## Role
You are session S2 (Backend) of SHOSHO. S7's first audit found four backend issues; one of them lets a guest have an order marked paid without paying. This boot fixes all four. It takes priority over anything else in your queue — the owner is about to create a Stripe account, and this must be in before a real card is ever charged.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2` run `git fetch origin && git checkout -b s2-04 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s2-04` → `main`.
Read FIRST: `/memory/boots/proposed/S7-02-S2-payment-security-fixes.md` — **that file is your specification**, with file:line for every item. Then `/docs/security.md` (S7's matrix, threat model and the standing rules for migrations), your own S2-02 log entry, and `/memory/decisions.md` D-011 (payments) and D-012 (security routing).

Two things S7 built that you now work under: `apps/backend/tests/security.test.ts` — the function-grants regression test that fails if any new function carries Supabase's default `anon`/`authenticated` EXECUTE; and migration 19, which fixed the NULL-unsafe role guards in `kitchen_pause` and `anonymise_silent_customers` (same class you found in S2-02). Do not regress either.

**Migration numbering:** S7's migrations took `20260926000019` and `...020`. Your S2-03 branch also used 19–22 and must renumber — see task 6.

## Tasks
1. **CRITICAL — `place_order` must not trust a client-supplied `payment_status`** (`rpc.sql:435-442,533-547`; `set_order_status_payments.sql:110-116`). Today a guest can post `payment_status: "authorized"` with any non-cash `payment_method` and the order reaches `paid` on delivery with no money moved. Fix the trust boundary, not the symptom:
   - A guest-originated `place_order` may only create an order as `pending`. `authorized` is reachable **only** from the Stripe webhook (`record_payment_event`), which is the one path that has provider evidence.
   - Cash keeps its own path (`pending` → `paid` on driver confirmation) — unchanged.
   - A staff caller (phone order) may still record a payment taken by other means; if you keep that, it must be gated on the staff role **and** write an `order_events` entry naming the actor, so it is auditable. Decide and document.
   - The auto-accept rule must key off a payment state the provider vouched for, never a client claim.
   - S7 notes a currently-passing S2 test exercises the bad path — find it, and make it assert the new refusal instead of deleting it.
2. **Refund duplication on reclaim** (S7 finding 3). `payment-worker` re-claims a job after 10 minutes; a crash between "Stripe refunded" and "job marked done" can refund twice, because refund has no authoritative already-done check the way capture/void do. Fix with an idempotency key Stripe will honour on retry, or by querying the charge's refund state before issuing, or both. Prove it with a test that simulates the crash-then-reclaim.
3. **`payment-worker` caller check** (S7 finding 7, found independently by S1 in S1-04). `verify_jwt = true` is satisfied by the **public** anon key, and the function then acts with the service role — so anyone holding the key (it ships in the guest web bundle) can POST `{"action":"install"}` to rewrite the pg_cron schedule or drain the job queue. Add an in-function check that the caller is the service role (or a shared secret the cron invocation carries). Note S1's constraint: the workflow's install POST and pg_cron both call it with the anon key today, so changing the function means changing how those two invoke it — coordinate the workflow change with S1 via a proposal rather than editing `migrate-staging.yml` yourself; S1 owns workflows and has just hardened that file.
4. **Low-severity items** (S7 finding 8): constant-time comparison for `tracking_token` in `create-payment-intent`; pin `search_path` on the six `SECURITY INVOKER` functions S7 lists. Small, do them here.
5. **Tests + contract.** Extend the suite for every fix above; keep `security.test.ts` green. Where a fix changes behaviour S3 or S4 can observe (task 1 does: the web checkout can no longer report `authorized`), update **§5.6** and **§6.8** and say so loudly in your report — S0 will route it to S3/S4, and the guest checkout must keep working against the new rule (it should: with no Stripe account, v1 already submits `pending`).
6. **Renumber your S2-03 migrations.** S7's 19/20 are on `main`. If `s2-03` has not merged by the time you start, rebase it (or this branch, whichever order you choose) so its four migrations are `...021`–`...024` and the timestamps are strictly newer than anything on `main`. Two files sharing a version prefix would make Supabase skip the second silently — S1's `plan` job now catches out-of-order, but not a same-prefix collision, so this is on you. Also fix the `db lint` failure that is currently red on `s2-03`: `record_order_attempt` uses the alias `e` in `jsonb_array_elements(...) e`, which collides with a PL/pgSQL variable — "column reference `e` is ambiguous" (sqlState 42702). Rename the alias.

## Boundaries
- Do NOT touch `apps/web`, `apps/backoffice`, `apps/infra` (workflows included — task 3 goes through a proposal to S1).
- Do NOT edit migrations that are on `main` — new files only.
- Do NOT weaken or delete S7's `security.test.ts` assertions to make something pass; if one of them is wrong, say why in the report and leave it failing for S0.
- Do NOT edit `/docs/security.md` (S7 owns it), `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT implement campaigns/CMS (that is still S2-05) and do not start the Stripe live walkthrough — no account exists yet.
- No secrets in the repo.

## Done when
- [ ] A guest cannot create an order in any state except `pending`; the only route to `authorized` is the Stripe webhook; a test asserts the refusal
- [ ] Refund jobs cannot double-refund across a reclaim, proven by a crash-simulation test
- [ ] `payment-worker` refuses a caller holding only the anon key; the coordination proposal for S1 is written
- [ ] Constant-time token comparison; `search_path` pinned on the six invoker functions
- [ ] `security.test.ts` and the whole `backend` job green; migrations renumbered with no version collision; `s2-03`'s lint failure fixed
- [ ] §5.6/§6.8 updated where behaviour changed, flagged in the report
- [ ] PR `s2-04` merged

## Reporting
1. `/memory/log.md`: `## <date> — S2 Backend — S2-04` — what changed per finding, what S3/S4 must now do differently, what went to S1, blockers.
2. `/memory/state.md`: ONLY the S2 row.
3. Commits `[S2-04]`.

## Next step
S2-05 (campaigns, automations, banners/site publish) and single-customer erasure stay proposals. Do not execute. After reporting — stop and wait for S0.
