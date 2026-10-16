# BOOT: S2-09 (Backend) — the `agent` Postgres role and its grants; plus the approval state C1 left out

## Role
You are session S2 (Backend) of SHOSHO. **C3 (S5's orchestrator) is blocked on this boot and on nothing
else.** Your own C1 (migration 33) is good work — the review found no defect in it — but it was written
before S7-03 concluded, and the two now disagree on one thing: migration 33 grants
`claim_agent_tasks` and `finish_agent_run` **to `service_role`** (lines 208 and 263), and S7-03 ruled
that the automation layer must connect as a dedicated non-`BYPASSRLS` role and **never** `service_role`.
Left as it is, S5 would either write through a role that bypasses every policy you and S7 have built, or
have nowhere to write at all. That is the whole job here.

This is a sequencing accident, not a fault: S2-08's own boot told you the schema must not care how the
writer authenticated, because the secret posture was S7's to rule on in C2. S7 then ruled, and
anticipated this exact gap in writing.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in
`/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2` run `git fetch origin && git checkout -f -B s2-09 origin/main`.
Merge `origin/main` before any PR touching `/memory` (D-009). PR `s2-09` → `main`.
Read FIRST: `/memory/plan.md` (section C), `/memory/decisions.md` **D-020**, **D-014** (claim the
filename first), then:

- **`/memory/boots/proposed/S7-03-S2-agent-role-grants.md`** — S7's filing, written for you.
  It is the specification for this boot; both its sections are tasks below.
- **`/docs/security.md` §9** — S7-03's full ruling, especially **§9.1** (identity), **§9.3** (the spend
  ceiling the registry must carry), **§9.5** (why Sales is the narrowest) and **§9.6** (audit integrity).
- `apps/backend/supabase/migrations/20261016000033_agent_runtime.sql` — your own C1. You are extending it.
- `/docs/api-contracts.md` §8.8 — you wrote it; it needs the new policies and the approval state.

**The fact the ruling turns on, which S0 verified independently rather than taking on trust:**
`is_staff()` → `auth_role()` → `select role from public.staff where id = auth.uid()`
(`20260920000002_settings_staff_zones.sql:48,53-60`). A direct `DATABASE_URL` connection carries **no
JWT**, so `auth.uid()` is null and `is_staff()` is false for everything. The agent role therefore
**cannot** inherit staff policies even by accident — which is the property that makes a narrow role safe,
and also the reason every policy it needs must be written explicitly and keyed on `current_user`.

## Tasks
1. **Claim the migration filename first (D-014).** Next free number is **34**.
2. **Create the `agent` role.** Non-`BYPASSRLS`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, no DDL
   privilege of any kind.
   **Do NOT set or commit a password. Not in the migration, not anywhere in the repo.** A migration is a
   git-tracked file; a role password in one is a published credential. Create the role without one and
   state in your report exactly what the owner or S1 must run out-of-band to give it a credential, and
   where that credential belongs (it is plan item D3's neighbour — S1's deploy surface at C5, not yours).
3. **Write the policies and grants** from S7's §1, keyed on `current_user = 'agent'` (not `is_staff()`,
   which is structurally false for this connection — see above):
   - `agent_runs` — `INSERT`, and `UPDATE` scoped to progress/outcome/cost columns **on its own open
     run only**. Never broad enough to rewrite a finished run's history (§9.6).
   - `agent_run_logs` — `INSERT` only. Never `UPDATE` or `DELETE`: an append-only log the writer can
     edit is not an audit trail.
   - `agents` (registry) — `SELECT` only. **No `UPDATE`.** An agent that can raise its own ceiling or
     flip its own `active` flag has defeated the ceiling by construction (§9.3).
   - `agent_tasks` — whatever the claim path needs, and `EXECUTE` on `claim_agent_tasks` granted to
     `agent` specifically, with the race-safety unchanged.
   - Universal revokes regardless of table: no `SELECT` on `staff`, no `DELETE` anywhere, no `UPDATE` on
     `payment_status`, `payment_authorized_cents`, `payment_captured_cents`, `payment_refunded_cents`,
     `total_cents`, and no DDL.
4. **Rule on `service_role`'s existing grants and say why.** Migration 33 grants `claim_agent_tasks` and
   `finish_agent_run` to `service_role`. S0's reading is that both should be **revoked** from it: the only
   intended caller is the orchestrator, which is now `agent`, and leaving the grant in place keeps a live
   path that silently defeats the whole ruling the first time someone reaches for the easier key. But you
   own this schema — if revoking breaks something you can see and S0 cannot, say so plainly and leave it,
   with the reason. Do not leave it in place silently.
5. **Build the approval state (S7's §2), and build it now rather than deferring it.** S7 filed this as "a
   consequence of the ruling, not an instruction to build it now", because Sales and Warehouse do not
   exist. **S0's ruling: it ships in this boot anyway**, for one reason — **C3's first agent is
   Accounting, and it produces Steuerberater-shaped output.** If C3 lands before this exists, the very
   first thing an agent ever produces is a number nothing can distinguish from a reviewed one. That is
   the exact failure S7 described, arriving in the next boot rather than a distant one.
   The requirement, not the design: nothing downstream — a Steuerberater export, a promoted Sales draft,
   a stock figure feeding a reorder — may treat an agent's output as live before an explicit state says
   `approved`. States `pending` / `approved` / `rejected`, with a reviewer and a timestamp, on whatever an
   agent **produces**, separate from the run record. **Whether that is a column on each output table or
   one shared `agent_outputs` table referencing a run is yours to decide and justify** — the only thing
   this boot forbids is deciding it later. Design it so C8 (stock) and the Sales drafts table can adopt
   it without a rewrite, since both are coming and neither exists.
   The reviewer is a **human staff member**, so that column keys on `auth.uid()` the ordinary way — note
   that it is written by a PostgREST session, not by `agent`, and that `agent` must have no grant that
   lets it approve its own output. That asymmetry is the whole point of the table.
6. **Test the refusals, not the row counts.** S4-03's finding stands and applies here: RLS matching zero
   rows returns `200 []`, so a test asserting "no rows came back" passes against a hole. Prove that
   `agent` is **refused** where it should be — especially approving its own output, updating the registry,
   touching `staff`, and rewriting a finished run.
7. **Update `/docs/api-contracts.md` §8.8** with the policies, the approval state and the role matrix.
   S5 (C3) and S4 (C4) both build against that text.

## Boundaries
- Do NOT create `apps/automation` or write orchestrator/agent/FastAPI code — S5's, C3.
- Do NOT set, generate, commit or print any password, for the `agent` role or anything else.
- Do NOT touch `.github/workflows/*` or `apps/infra/**` — S1's; the credential plumbing is C5.
- Do NOT touch `apps/web`, `apps/backoffice`, `apps/e2e`.
- Do NOT edit `/docs/security.md` (S7's — §9 is their ruling; propose if it is wrong), `/memory/decisions.md`,
  `/memory/plan.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT build the Sales drafts table, the stock schema, or any agent-specific table. Only the role, its
  grants, and the approval shape.
- Do NOT reseed or truncate `shosho-staging`.
- **The VAT change S4-05 filed against you remains CANCELLED (D-019).** It is in `proposed/`. Pickup is
  charged 7% and that is correct — the owner ruled the rate follows the item, and `order_type` has no
  on-premises value. Executing it would add 12 points of tax to every Abholung order.

## Done when
- [ ] Migration 34 claimed in the first commit
- [ ] `agent` role exists: non-`BYPASSRLS`, no DDL, **no password in the repo**, with the out-of-band step
      for the credential written down for S1/the owner
- [ ] Policies and grants per S7 §1, keyed on `current_user`, with the universal revokes
- [ ] `service_role`'s grants on `claim_agent_tasks` / `finish_agent_run` ruled on explicitly — revoked,
      or kept with a stated reason
- [ ] Approval state shipped, its location justified, and designed so C8 and Sales drafts can adopt it
- [ ] `agent` **cannot** approve its own output, update the registry, read `staff`, or rewrite a finished
      run — each proven by a refusal test, not a row-count test
- [ ] §8.8 updated
- [ ] `backend (supabase)` CI green; PR `s2-09` merged

## Reporting
`/memory/log.md`: `## <date> — S2 Backend — S2-09` — where you put the approval state and why, your ruling
on `service_role`, the exact out-of-band step for the role's credential, and anything in S7-03 §9 that was
wrong or impossible against the hosted project. **If the `agent` role cannot be made to work for a direct
`DATABASE_URL` connection on hosted Supabase — pooler behaviour, role inheritance, anything — say so
immediately and loudly rather than working around it: that would invalidate S7-03's central ruling and
S0 would rather re-plan than have C3 built on a workaround.**
`/memory/state.md`: ONLY the S2 row. Commits `[S2-09]`. Findings outside your boundary → S7 (D-012), tell
S0, do not wait.

## Next step
C3 (S5's orchestrator + the Accounting agent) unblocks on this, and C5 (S1's deploy surface) needs the
credential step your report names. Still yours and queued: **B4** `orders_kitchen_read` unbounded and
**B5** `settings.draft` leaking to kitchen/driver — **both raised in priority 2026-10-16** when the owner
chose A2 (the owner enters the gate pair per device, so kitchen and driver tablets now hold live sessions
and those two findings became real exposure rather than theoretical). Then D-018's `place_order` throttle,
then C8's stock schema. Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and
wait for S0.
