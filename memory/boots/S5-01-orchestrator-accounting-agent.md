# BOOT: S5-01 (Automation) — the orchestrator skeleton and the first agent (Accounting)

## Role
You are session **S5 (Automation)** of SHOSHO, and this is **the first S5 session that has ever run**.
`apps/automation` holds exactly two files today — `.env.example` and `.gitkeep` — so you are starting a
new app, not extending one. This is **step C3** of `memory/plan.md`. Build the orchestrator skeleton and
**one** agent: **Accounting**. Do not build a second agent, do not build sending, do not deploy.

Two sessions spent their whole boots making this one safe to write. **Read their output before your own
design**: S2 built the runtime schema and the `agent` role (migrations 33 and 34), and S7 ruled the
privilege boundary (`docs/security.md` §9). **That ruling is binding, not advisory.**

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** `.worktrees/s5` does not exist yet —
from the root checkout run `git fetch origin && git worktree add .worktrees/s5 -b s5-01 origin/main`, then
work in `.worktrees/s5`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s5-01` → `main`.

Read FIRST, in this order:
- `/memory/plan.md` — section C (you are step 3), and section D for what the owner still owes.
- `/memory/decisions.md` — **D-020** (the architecture, and why it is native code and not n8n),
  **D-019** (VAT is per-item — your Accounting agent depends on this and it is easy to get wrong; see
  task 4), **D-017** (no SMTP, so nothing you build may send), **D-015** (no client-side analytics).
- **`/docs/security.md` §9 in full** — S7-03's ruling. §9.1 identity, §9.3 the spend ceiling,
  §9.4 the "may never" list, §9.5 prompt injection, §9.6 audit integrity. You implement to this.
- **`/docs/api-contracts.md` §8.8, §8.8a, §8.8b** — the runtime, the `agent` role, and the approval state.
- `apps/backend/supabase/migrations/20261016000033_agent_runtime.sql` and `…34_agent_role.sql` — read the
  comments, not just the DDL. They explain the choices you must not re-litigate.
- `apps/automation/.env.example` — written 2026-09-20, never used. It is a sketch, not a contract; §9 and
  `_deploy.yml` are the contract.

**How you connect, and why it is not negotiable.** `AUTOMATION_DATABASE_URL`, as the dedicated **`agent`**
Postgres role, **directly — no PostgREST, never `service_role`**. S2-09 revoked `service_role`'s execute on
`claim_agent_tasks` and `finish_agent_run` precisely so this cannot be done the easy way. The consequence
you must design around: a direct connection carries **no JWT**, so `auth.uid()` is null and
`is_staff()` is false for everything. Your policies are the ones keyed on `current_user = 'agent'`. You
inherit no staff access by accident, which is the property that makes this safe.

**What you cannot verify, stated up front so you do not waste a boot discovering it.** The `agent` role has
**no password yet** — setting one is an out-of-band step that belongs to S1's step C5, which is itself
blocked on the owner's Anthropic key (plan item D3). So: **develop and verify against a local Supabase
stack**, where migrations 33/34 give you the role and you can set a local password yourself. Staging and
production verification are **out of scope for this boot** — say so plainly in your report rather than
implying you tested something you could not.

## Tasks
1. **The package, so CI actually runs it.** `.github/workflows/ci.yml` already has a `python (automation)`
   job whose first step is "Detect python project" — today it detects nothing and no-ops. Create the
   project so it detects, installs and runs: lint, types and tests. **Read that job before you choose your
   tooling**, so your choices and its expectations match; if the job needs a change to be useful, **say so
   in your report — do not edit it**, `.github/workflows/**` and `apps/infra/**` are S1's (D-004).
2. **The orchestrator loop**, and nothing more than a loop in this boot: claim work with
   `claim_agent_tasks`, run the agent, close with `finish_agent_run`. Both are `security definer` and
   granted to `agent` only. Claiming a task **is** starting its run — migration 33 returns the run, not the
   task, so there is never a gap between "claimed" and "has a run row to log against". Use that; do not
   invent a second bookkeeping path. Write ordered log lines to `agent_run_logs` as you go, since S4's
   dashboard (C4, parallel to you) reads them live over realtime.
3. **Enforce the spend ceiling BEFORE each model call, not after.** §9.3 is explicit about the order, and
   the reason is that a ceiling checked afterwards has already spent the money. Read the ceiling from the
   registry (`agents.config`); you have `SELECT` and deliberately **no `UPDATE`** there, because an agent
   that can raise its own ceiling has defeated it by construction. Record `input_tokens`,
   `output_tokens` and `cost_usd` through `finish_agent_run` — S4's dashboard surfaces a runaway from
   those columns, so a run that does not report cost is a blind spot, not a tidiness issue.
4. **The Accounting agent — and the VAT trap that already caught S0.** It reads orders, order items and
   payment events and produces a Steuerberater-shaped summary. **VAT per D-019: the rate is a property of
   the item (`menu_items.vat_delivery_pct`), not of the order type.** Read the rate each order actually
   used. **Do not assume 7, do not assume 19, and do not branch on `delivery` vs `pickup`.** This is not a
   hypothetical caution: S0's own S4-05 boot asserted "pickup VAT is computed at 19% from
   `vat_onsite_pct`" and both halves were false — `vat_onsite_pct` is read by nothing, every order is
   charged `vat_delivery_pct`, and S4 only caught it by reading the code instead of trusting the boot. An
   agent that "corrects" pickup to 19% would add 12 points of tax to every Abholung order.
5. **Write the output as `agent_outputs`, `status` left at its default `pending`.** §8.8b. Your agent
   **produces a candidate, never a fact.** It has no path to approve its own output — `review_agent_output()`
   is a human staff action and `agent` has no grant on it. Nothing downstream may treat a `pending` row as
   live. If you find yourself wanting to skip this for "obviously correct" numbers, that is precisely the
   case S7-03 §9.6 was written for.
6. **Prompt injection, even though Accounting is the low-exposure case.** §9.5's tiered read / draft /
   human-confirm model. Accounting reads only our own database, so it is the easy one — which makes it the
   right place to establish the pattern **Sales will need**, where the input is attacker-controlled
   Instagram DMs. Treat row content as data, never as instructions, and say in your report where the
   boundary between "data the model summarises" and "instructions the model follows" is enforced in code.
7. **FastAPI: health only.** D-020 has FastAPI fronting Lieferando/Wolt, but that is **step C7 and blocked
   on the owner's platform access**. Scaffold the app with a health endpoint and no external route.
   Unauthenticated ingress is how TETA+PI's `mcp.tetapi.dev` hole happened — do not open one you do not need.
8. **Model choice: name it explicitly, do not invent a string.** Valid ids are `claude-opus-5`,
   `claude-sonnet-5`, `claude-haiku-4-5-20251001`. Default to **`claude-sonnet-5`** for this agent and say
   why in your report; reach for `claude-opus-5` only where the reasoning genuinely needs it, and record
   the choice in config rather than hardcoding it in a call site, so the ceiling work in task 3 and a later
   model change do not need a code edit.

## Boundaries
- Do NOT touch `apps/web`, `apps/backoffice`, `apps/backend`, `apps/e2e`, `apps/infra`, or
  `.github/workflows/**`. You create `apps/automation` and nothing else.
- Do NOT connect as `service_role`, and do NOT work around the revoked grants. If something you need is
  not granted to `agent`, that is a finding for S2 and S7 — **report it, do not route around it.**
- Do NOT set, generate, commit or print any password or key. No secret in the repo, ever. The `agent`
  role's credential and the Anthropic key are S1's step C5 and the owner's D3.
- Do NOT send anything to anyone — no email, no push, no DM, no webhook out (D-017). An agent writes rows.
- Do NOT build a second agent, the Sales drafts table, the stock schema, or any new table. Schema is S2's.
- Do NOT add client-side analytics or an events table (D-015), whatever a future Grow agent would like.
- Do NOT write to `agent_outputs.status`, `reviewer_id` or `reviewed_at` — those are the human's.
- Do NOT edit `/docs/api-contracts.md` (propose instead), `/docs/security.md`, `/memory/decisions.md`,
  `/memory/plan.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT reseed or truncate `shosho-staging`.

## Done when
- [ ] `apps/automation` is a real project that the existing `python (automation)` CI job detects and runs
      green — lint, types, tests — with any needed change to that job **reported, not made**
- [ ] The orchestrator claims, runs and closes a task through `claim_agent_tasks` / `finish_agent_run`,
      connecting as `agent` via `AUTOMATION_DATABASE_URL`, demonstrated against a **local** stack
- [ ] The spend ceiling is checked **before** each model call, read from the registry, with per-run
      `input_tokens` / `output_tokens` / `cost_usd` recorded
- [ ] The Accounting agent produces a Steuerberater-shaped output as an `agent_outputs` row left `pending`,
      using **each order's actual VAT rate** per D-019 — no assumed 7, no assumed 19, no branch on order type
- [ ] The agent provably **cannot** approve its own output, raise its own ceiling, read `staff`, or rewrite
      a finished run — proven by refusals, not by row counts (RLS matching zero rows returns `200 []`)
- [ ] Ordered log lines land in `agent_run_logs` as the run proceeds
- [ ] FastAPI health endpoint only; no external route, no unauthenticated ingress
- [ ] Model id named from the valid list, held in config, with the choice justified
- [ ] Report states plainly that staging/production verification was **out of scope** and why
- [ ] `python (automation)` CI green; PR `s5-01` merged

## Reporting
`/memory/log.md`: `## <date> — S5 Automation — S5-01` — where the ceiling is enforced and how you proved
the order, how the VAT rate is read per order, where the data/instructions boundary lives in code, your
model choice and why, what you could not verify without C5/D3, and anything in §8.8 or §9 that was wrong,
missing or awkward to implement. **If §9 cannot be implemented as ruled — the `agent` role cannot do
something it must, the ceiling cannot be enforced where S7 put it — say so loudly and stop rather than
working around it.** S0 would rather re-plan than ship an orchestrator that quietly widened its own access.
`/memory/state.md`: ONLY the S5 row (it is currently the "never started" row — replace it).
Commits `[S5-01]`. Security findings outside your boundary → S7 (D-012), tell S0, do not wait.

## Next step
After this: **C6** Grow agent (#2, reads existing reports, needs nothing new), **C7** the Lieferando/Wolt
FastAPI endpoints (owner's platform access), **C9** Warehouse (needs C8's stock schema from S2), **C10**
Sales (owner's Meta app — the longest lead time in the plan). **C5** — S1 giving this app a deploy surface
and the two secrets — can start as soon as the owner provides the Anthropic key.
Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
