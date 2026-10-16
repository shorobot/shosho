# BOOT: S2-08 (Backend) — the agent runtime schema: registry, runs, a claimable task queue, logs

## Role
You are session S2 (Backend) of SHOSHO. You are building **step C1** of `memory/plan.md`: the tables the
automation layer runs on and the back-office dashboard reads. Nothing in `apps/automation` exists yet —
that is deliberate. **Both S5 (the orchestrator) and S4 (the dashboards) block on this boot**, so it is
schema and contract only: no runner, no agent, no sending.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in
`/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2` run `git fetch origin && git checkout -f -B s2-08 origin/main`
(`-f -B`, not `-b` — the worktree still sits on `s2-06`). Merge `origin/main` before any PR touching
`/memory` (D-009). PR `s2-08` → `main`.
Read FIRST: `/memory/plan.md` (sections C and B — B4 and B5 are also yours and are **not** in this boot),
`/memory/decisions.md` — **D-020** (the architecture and why step C2 gates the deploy, not this step),
**D-014** (claim the migration filename before writing it), **D-015** (no client-side analytics — the Grow
agent will ask; the answer is server-side or nothing), then:

- `apps/backend/supabase/migrations/20261006000028_automations.sql` — **read this before designing anything.**
  You already built `automations` + `automation_runs`, and their shape is the house style you should follow:
  service-role writes only, owner/operator read-only audit, `revoke all … from anon`, no insert policy,
  nullable `customer_id` so a GDPR anonymisation never has to touch the audit trail.
- `proposed/S7-02-S2-kitchen-driver-reach-and-rls-fixes.md` — S7-02's findings. Two of them are about
  exactly the mistake this boot could repeat.
- `/docs/api-contracts.md` §8 — you write the new subsection; S0 reviews it.

**What already exists and what it does not cover.** `automations` is keyed on
`automation_kind as enum ('welcome','win_back_45d','birthday','review_after_delivery')` — four customer
*messaging* automations — and `automation_runs` is **one row per customer considered**. That is the
marketing half and it is fine as it is. The agent layer in D-020 is wider: **Accounting, Warehouse and Grow
agent runs are not about a customer at all**, and the agent set is not a fixed enum of four message kinds.
So this boot adds a general runtime alongside what you built; it does not replace it.

## Tasks
1. **Claim the migration filename first (D-014)**, then write it. Next free number is **33** —
   `20261006000032_publish_and_funnel_fix.sql` is the current last. Say the claimed name in your first
   commit message so a parallel session cannot take it.
2. **The schema.** Shape is yours to design; these are the requirements, not a table list:
   - **An agent registry** — one row per agent, with an `active` flag and config, the same way
     `automations` holds one row per kind. The agents D-020 names are Sales, Accounting, Warehouse, Grow,
     Quality. Seed them inactive, as you did for the four automation kinds, for the same reason: a config
     table with no row for something the UI expects is a worse first run than an inactive row.
   - **A run record** — one row per *invocation* of an agent, not per customer. It must answer: which
     agent, when it started, when it ended, what it concluded, did it fail, and how much did it cost. Cost
     matters and is not optional — see task 4.
   - **A claimable task queue.** Agents will run concurrently and more than one process may poll.
     **Reuse the race-safe claim you already wrote** for `claim_campaign_recipients` rather than inventing
     a second pattern; if that one's locking is not right for this shape, say why in your report instead of
     quietly diverging.
   - **Log lines**, attached to a run, ordered, readable by the dashboard as they arrive.
3. **Realtime, deliberately.** S4's dashboards (step C4) are specified as Next.js + Supabase Realtime, so
   the run and log tables have to actually be in the realtime publication — this is the step everyone
   forgets and it surfaces as "the dashboard works but never updates". Add them explicitly and say in your
   report which tables you added and which you deliberately did not. Note the precedent: S2-02's guest
   realtime is a **broadcast**, not table replication — decide which this wants and justify it.
4. **Cost is a first-class column, not a nicety.** An agent that loops costs real money against the
   owner's Anthropic account. D-016 already treats an unbounded spend as a *financial exposure* rather
   than hygiene — the SMS-pumping clause — and the same reasoning applies here with no rate limiter in
   front of it. Record per-run token or cost figures so a runaway is visible in the dashboard and in a
   report, and say in your report what you did **not** build (a ceiling is S7's call in step C2, not yours).
5. **RLS, informed by what S7-02 just found.** Both of their findings are failure modes this schema could
   reproduce:
   - `orders_kitchen_read` is **unbounded** — `using (public.is_staff('kitchen'))` with no row
     restriction. Do not give any agent table a policy of that shape.
   - `settings.draft` leaks to kitchen/driver because migration 32 narrowed **only `anon`**, leaving
     `authenticated` holding every column. **Column grants and row policies are two separate things and
     you need both.** Verified by S0 at `20261006000032…:23-24`.
   Agent runs and logs will contain model prompts and outputs, which means they may contain customer data
   and operational detail. **Owner/operator read, kitchen and driver refused, `anon` revoked outright.**
   State the role matrix explicitly in your report rather than leaving it to be inferred from the SQL.
6. **GDPR follows your own precedent.** `automation_runs`' comment explains why `customer_id` is nullable
   with `on delete set null` — so an Art. 17 anonymisation never has to rewrite the audit trail. Carry that
   reasoning anywhere an agent run references a person, and say where you chose not to.
7. **Write the contract** — a new `/docs/api-contracts.md` §8 subsection: the tables, the claim function's
   signature and guarantees, the role matrix, the realtime surface, and what is *not* there yet. S5 and S4
   will both build against this text, so the things you leave unstated are the things they will each guess
   differently.
8. **Decide and state one design question rather than leaving it open:** does the existing marketing runner
   (`automations` / `automation_runs`) become an agent under the new tables, or stay a separate path? Both
   are defensible — one runtime to observe, versus not rewriting something that already works and already
   has a UI in S4-04's Marketing screen. Pick one, say why, and if the answer is "stay separate", say how
   the dashboard shows both without pretending they are the same thing.

## Boundaries
- Do NOT create `apps/automation` or write a single line of orchestrator, agent or FastAPI code. That is
  S5, step C3, and it is blocked on S7's boundary (C2) as well as on you.
- Do NOT provision, reference or require `ANTHROPIC_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` anywhere. The
  schema must not care how the writer authenticated. **The secret posture is S7's ruling in C2** — D-013
  removed both from the server and reversing that is explicitly not yours.
- Do NOT touch `apps/web`, `apps/backoffice`, `apps/infra`, `apps/e2e`.
- Do NOT edit `/docs/security.md` (S7's), `/memory/decisions.md`, `/memory/plan.md`, `/memory/sessions.md`,
  `/docs/design/*`. `api-contracts.md` — only the one §8 subsection this boot names.
- Do NOT build `site_events` or any client-side event table (D-015), whatever the Grow agent would like.
- Do NOT reseed or truncate `shosho-staging`. Credentials are on the owner's machine only — ask, never print.
- Do NOT fix B4/B5 (`orders_kitchen_read`, `settings.draft`) in this boot. They are yours and they are a
  separate PR — mixing a security fix into a schema PR makes both harder to review and to revert.
- **The VAT change S4-05 filed against you is CANCELLED (D-019), not deferred.** You will find it in
  `proposed/`. Do not execute it: pickup is charged 7% and that is correct — the owner ruled the rate
  follows the item, and `order_type` has no on-premises value to apply 19% to. Executing it would add 12
  points of tax to every Abholung order.

## Done when
- [ ] Migration filename claimed in the first commit, number 33
- [ ] Agent registry, run records, a claimable task queue and log lines exist, with the claim reusing your
      existing race-safe pattern or a stated reason it could not
- [ ] Per-run cost/token figures recorded; what you did not build is named
- [ ] Role matrix stated explicitly: owner/operator read, kitchen/driver refused, `anon` revoked — **with
      both column grants and row policies**, and a test proving kitchen is refused rather than silently
      no-op'ed (S4-03's finding: RLS matching zero rows returns `200 []`, so test the refusal, not the row count)
- [ ] Realtime membership decided, applied and reported — broadcast versus replication justified
- [ ] GDPR nullability carried across, with any exception named
- [ ] `/docs/api-contracts.md` §8 subsection written
- [ ] The marketing-runner question answered, not deferred
- [ ] `backend (supabase)` CI green; PR `s2-08` merged

## Reporting
`/memory/log.md`: `## <date> — S2 Backend — S2-08` — the role matrix, the realtime decision and why, the
marketing-runner ruling, what you recorded for cost and what you left to S7, and anything in §8 that was
awkward to write. `/memory/state.md`: ONLY the S2 row. Commits `[S2-08]`.
Security findings outside your boundary go straight to S7 (D-012) — tell S0, do not wait.

## Next step
C3 (S5's orchestrator + the Accounting agent) and C4 (S4's dashboards) both unblock on this. Still yours
and queued: **B4** `orders_kitchen_read` unbounded, **B5** `settings.draft` leaking to kitchen/driver,
D-018's `place_order` throttle (unblocked now that #77 landed), and C8's ingredient/recipe/stock schema —
which is large and should not start before C3 ships. Proposals → `/memory/boots/proposed/`. Do not execute.
After reporting — stop and wait for S0.
