# BOOT: S4-06 (Back-office) — the agent dashboards, the human approval screen, and one dead control

## Role
You are session S4 (Back-office) of SHOSHO. This is **step C4** of `memory/plan.md`: the place where the
automation layer becomes visible and, more importantly, **the place where a human decides whether an
agent's output counts.** D-020 put agent observability inside the back-office on purpose — one auth model,
one design system, nothing extra to deploy.

**S5-01 (step C3) is running in parallel.** Boundaries do not overlap: they create `apps/automation`, you
own `apps/backoffice`. But it means **the tables will be empty while you build** — see task 1.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in
`/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s4` run `git fetch origin && git checkout -f -B s4-06 origin/main`
(`-f -B`, not `-b` — the worktree still sits on `s4-05`). Merge `origin/main` before any PR touching
`/memory` (D-009). PR `s4-06` → `main`. UI German primary with the EN toggle.

Read FIRST:
- `/memory/plan.md` — section C (you are step 4) and section B (B3 is yours and is in this boot).
- `/memory/decisions.md` — **D-020** (why the dashboards live here), **D-019** (the VAT ruling behind B3).
- **`/docs/api-contracts.md` §8.8, §8.8a, §8.8b** — the runtime, the role, the approval state.
- **`/docs/security.md` §9.3** (the spend ceiling and the alarm it says belongs in *your* dashboard) and
  **§9.6** (why `pending` must never read as live).
- `apps/backend/supabase/migrations/20261016000033_agent_runtime.sql` and `…34_agent_role.sql` — the
  comments explain what is replicated over realtime and, deliberately, what is not.
- `memory/boots/S5-01-orchestrator-accounting-agent.md` — what S5 is building, so your screens match the
  thing that will actually write these rows.

**What is already true, so you do not rediscover it.** Migration 33 added `agent_tasks`, `agent_runs` and
`agent_run_logs` to the `supabase_realtime` publication, and migration 34 added `agent_outputs` — plain
`postgres_changes` replication, correct here because staff read with a real per-user JWT (contrast the
guest tracking broadcast, which exists only because the anon JWT is shared). **`agents` — the registry —
was deliberately left OUT** of the publication: it mutates rarely and a refetch after save is enough. Do
not add it; that is S2's call and they argued it.

## Tasks
1. **Decide and state how you develop against empty tables.** No agent has ever run, so every one of these
   tables is empty and will stay empty until S5-01 lands. Seed your own rows locally to build against —
   and **make the zero-row case a designed state, not an afterthought**, because it is what the owner will
   see first. The honesty rule from S4-04/S4-05 applies with full force: **never render an absent number
   as `0`.** A spend of `€0.00` and "no agent has run yet" are different claims, and the second is the true
   one. You already established the "value | unavailable" convention in `lib/marketing.ts` — reuse it
   rather than inventing a third.
2. **The run/queue/log views, live.** Queue depth and status (`queued` / `processing` / `done` / `failed`),
   runs with their conclusion and duration, and a run's **ordered** log lines — ordered by `seq`, the
   `bigserial`, **not** by `at`: concurrent writers share a millisecond and migration 33 says so. Subscribe
   to the three replicated tables; unsubscribe on unmount. A log view that works but never updates is the
   classic failure here, so prove an inserted row appears without a refetch.
3. **The approval screen — the point of the whole step.** `agent_outputs` rows arrive `pending`. A human
   approves or rejects via **`review_agent_output(p_output_id, p_decision, p_note)`**. Do not write
   `status`, `reviewer_id`, `reviewed_at` or `review_note` directly — the agent's column grant excludes
   them and that function is the only legitimate path.
   Three behaviours of that function your UI must present rather than fight:
   - It is granted to **`authenticated`** — all four roles — but guards **internally**:
     non-owner/operator gets `42501 forbidden_for_role`. **This is the loud-failure path**, unlike a plain
     table write which RLS turns into a silent `200 []` (S4-03's finding). Surface the refusal as a refusal.
   - `p_decision = 'pending'` is rejected: a review cannot be un-made. Do not offer it in the UI.
   - It only matches `status = 'pending'`, so a second review of the same row raises
     `output_not_found_or_already_reviewed`. Two operators on two tablets will hit this; show what happened
     instead of a generic error.
4. **Surface spend, because §9.3 says the alarm lives here.** Per-run `input_tokens` / `output_tokens` /
   `cost_usd`, aggregated per agent and per day, against the ceiling held in `agents.config`. The failure
   this exists to catch is a runaway loop billing the owner's Anthropic account with no rate limiter in
   front of it — so make "approaching or over the ceiling" visible at a glance, not buried in a table. If
   a ceiling is not configured, say **that**, rather than implying there is no spend.
5. **The registry screen.** Five agents, seeded inactive (`sales`, `accounting`, `warehouse`, `grow`,
   `quality`). `agents_staff_all` gives owner/operator full CRUD, so toggling `active` and editing config
   needs no RPC. Only **accounting** will do anything after S5-01; the other four are inactive by design,
   and the screen should say which are not implemented yet rather than offering a toggle that silently
   achieves nothing — the same honesty S4-04 applied to "Senden".
6. **Guards, tested as guards.** Owner/operator only on every one of these routes; **kitchen and driver
   refused**. S4-03's finding is the one to remember: a write RLS denies returns `200 []`, so a test
   asserting "no rows" passes against a hole. **Test the route guard and the function refusal**, not the
   row count. This matters more than it used to: the owner chose **A2** on 2026-10-16 — they enter the
   basic-auth pair per device, so a kitchen tablet now holds a live kitchen session in a kitchen.
7. **B3 — remove the dead VAT control.** `components/menu/ItemEditor.tsx` offers an operator a 7 % / 19 %
   dropdown for **`vat_onsite_pct`**, and the backend reads that column **nowhere** — every order is
   charged the item's `vat_delivery_pct`. Per **D-019** the rate follows the item, and SHOSHO has no
   on-premises channel for an on-premises rate to apply to (`order_type` is `enum ('delivery','pickup')`).
   So that control is a setting an operator can change with no effect: exactly the class of thing S4-04 was
   told to render as unavailable rather than fake. Remove it (or mark it reserved and non-editable, your
   call — justify it). **Leave the `vat_delivery_pct` dropdown exactly as it is**: it is the real one, and
   it is already correct. Do not touch the backend column — that is S2's cosmetic cleanup, if ever.

## Boundaries
- Do NOT touch `apps/automation` (**S5-01 is live there right now**), `apps/web`, `apps/backend`,
  `apps/e2e`, `apps/infra`, or `.github/workflows/**`.
- Do NOT write a migration, policy or grant. If a screen needs something the schema does not offer,
  that is a finding for S2 — report it, do not work around it with a wider query.
- Do NOT write `agent_outputs.status` / `reviewer_id` / `reviewed_at` / `review_note` by any path other
  than `review_agent_output()`.
- Do NOT add `agents` to the realtime publication, and do NOT add a publication of your own.
- Do NOT fix **B2** (`apps/web/lib/csp.ts`'s missing dev `unsafe-eval` carve-out). It is real and still
  open, but `apps/web` is S3's and the boundary discipline is worth more than the one line.
- Do NOT edit `/docs/api-contracts.md` (propose instead), `/docs/security.md`, `/memory/decisions.md`,
  `/memory/plan.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT reseed or truncate `shosho-staging`. Credentials are the owner's; the gate username is `shos-bo`
  and the password is **not** in the repo (`memory/infra-access.md`) — ask, never print.

## Done when
- [ ] Queue, runs and ordered log lines render and **update live** — an inserted row appears without a
      refetch, demonstrated, with unsubscribe on unmount
- [ ] Logs ordered by `seq`, not by `at`
- [ ] Approval screen drives `review_agent_output()` only; `42501`, the `pending` rejection and the
      already-reviewed case each handled as themselves rather than as a generic error
- [ ] Spend per agent and per day against the configured ceiling, with "no ceiling configured" and "no run
      yet" rendered as those statements and **never as `0`**
- [ ] Registry shows the five agents and is honest about which do nothing yet
- [ ] kitchen and driver refused on every route — proven by guard and function refusal, not row counts
- [ ] **B3** done: the `vat_onsite_pct` control gone or provably inert-and-labelled; `vat_delivery_pct`
      untouched
- [ ] Empty states look deliberate
- [ ] `node (backoffice)` CI green; PR `s4-06` merged

## Reporting
`/memory/log.md`: `## <date> — S4 Back-office — S4-06` — how you proved realtime actually arrives, what the
zero-data dashboard looks like, what you chose for B3 and why, and anything in §8.8/§8.8b or §9.3 that was
wrong or awkward — **especially if a screen needed data the schema cannot give you**, since S5 and S2 are
both still in motion and a contract gap found now is cheap.
`/memory/state.md`: ONLY the S4 row. Commits `[S4-06]`.
Security findings outside your boundary go straight to S7 (D-012) — tell S0, do not wait.

## Next step
After this, every section the back-office is planned to have exists. Still S4-adjacent: the
`S7-02-S4-backoffice-hardening.md` leftovers, `S7-S4-03-httponly-correction.md`, and whatever S5-01's
report asks for once a real agent run has produced a real output. Proposals → `/memory/boots/proposed/`.
Do not execute. After reporting — stop and wait for S0.
