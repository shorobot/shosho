# Proposal → S2 Backend: grants and one missing table for the `agent` Postgres role

From S7 Security, S7-03 (the privilege boundary ruling, `docs/security.md` §9). Not urgent — nothing in
`apps/automation` exists yet (S5 blocks on S7-03 and on S2-08/C1) — but both items land in schema S2
owns, so filing now rather than after S5 starts.

## 1. The dedicated `agent` role and its grants (full reasoning: `docs/security.md` §9.1)

Ruling: the automation layer connects as a dedicated, non-`BYPASSRLS` Postgres role (`agent`), never
`service_role`. It connects via `DATABASE_URL` directly, not through PostgREST, so it has no JWT and
`auth.uid()`/`auth_role()`/`is_staff()` all evaluate as if it were an anonymous, non-staff caller —
existing staff policies cannot be reused and must not be relied on. New policies, keyed on
`current_user = 'agent'`, are needed wherever an agent needs access.

When C1 (S2-08) lands, its registry/run/queue/log tables will need their own insert/update policies for
`agent` — today's shape (service-role-implicit-write, staff-read-only, modeled on `automations`/
`automation_runs` from migration 28) has nowhere for `agent` to write at all. Concretely, for whichever
of these tables an orchestrator process needs to write to directly (claiming a queued task, writing a
log line, updating its own run's status/cost):

- `agent_runs` (or whatever C1 names it): `agent` needs `INSERT`, and `UPDATE` scoped to columns that
  record progress/outcome/cost on **its own open run** — never a grant broad enough to rewrite a
  finished run's history (ties to §9.6's audit-trail integrity).
- `agent_logs`: `agent` needs `INSERT` only. Never `UPDATE`/`DELETE` — an append-only log an agent can
  edit is not an audit trail.
- The agent **registry** table (one row per agent, `active`/config/ceiling): `agent` needs `SELECT`
  only, to read its own configured ceiling (§9.3). **No `UPDATE`** — an agent that can raise its own
  spend ceiling or flip its own `active` flag has defeated the ceiling by construction.
- The claimable task queue: whatever locking shape reuses `claim_campaign_recipients`'s pattern needs
  its claim function grantable to `agent` specifically (`EXECUTE`), with the same race-safety.

Per-agent read/write needs beyond the run/queue/log tables, enumerated in `docs/security.md` §9.1's
table — repeating the ones with a concrete grant shape now, since C8 (Warehouse's stock schema) and the
Sales drafts table don't exist yet and should be designed with this already in mind:

- **Accounting**: `SELECT` on `orders`, `order_items`, `payment_events`, `payment_jobs`, `settings`
  (business/tax keys only — same column-grant scoping `settings_staff_keys()` already models).
  No write anywhere in the live schema.
- **Grow**: `SELECT` on `orders`, `order_items`, whatever `report_*` reads, `campaigns`, `automations`.
  No write.
- **Warehouse** (blocked on C8): write access, when it exists, should be a column grant on stock
  *quantity* columns only — never the ingredient/recipe/BOM definition itself, and never price.
- **Sales** (blocked on D1/D-017): needs a **drafts** table that does not exist yet. Design it so
  `agent` can `INSERT`/`SELECT` but a draft becoming a real order goes through `place_order` via a
  human's approval action in the back-office — `agent` should have no path to `orders` at all for this
  agent. See §9.5 of the ruling for why this one is deliberately the narrowest.

Universal revokes for `agent`, regardless of table: no `SELECT` on `staff`, no `DELETE` anywhere, no
`UPDATE` on money columns (`payment_status`, `payment_authorized_cents`, `payment_captured_cents`,
`payment_refunded_cents`, `total_cents`), no DDL privilege at all.

## 2. A missing piece of C1's shape: "an agent concluded X" vs "a human confirmed X" (full reasoning:
`docs/security.md` §9.6)

C1's run/log tables answer "what happened during a run." They do not answer "is this number currently
trusted." A run can finish successfully and log a wrong total; nothing distinguishes that from a run
whose output a human has actually reviewed. Needed: a status column — `pending` / `approved` /
`rejected`, with a reviewer and a timestamp — on whatever an agent *produces* (a report row, a draft
row), separate from the run record itself. Where this lives (a column on each output-shaped table, or
one shared `agent_outputs` table referencing a run) is S2's design call; the requirement is that nothing
downstream (a Steuerberater export, a promoted Sales draft, a stock figure feeding a reorder decision)
treats an agent's output as live before that status says `approved`.

This is a consequence of the ruling, not an instruction to build it now — C8/Sales/Warehouse don't exist
yet either. Filed so it's in view before C1 or C3 are called finished, not discovered after.
