# apps/automation — the agent orchestrator and the Accounting agent

D-020's automation layer. Step **C3** of `memory/plan.md`. Built to the boundary `docs/security.md`
§9 rules and the contract `docs/api-contracts.md` §8.8 / §8.8a / §8.8b describes.

## What this is

A small Python package with three parts:

| Part | Module | What it does |
|---|---|---|
| Orchestrator | `orchestrator.py` | claim → run → close, via `claim_agent_tasks` / `finish_agent_run` |
| Spend ceiling | `ledger.py`, `llm.py` | refuses a model call **before** it is issued (§9.3) |
| Accounting agent | `agents/accounting.py` | a Steuerberater-shaped period summary, written as a `pending` `agent_outputs` row |

Plus `api.py`, a FastAPI app with a single `/health` route and nothing else — the
Lieferando/Wolt endpoints are step **C7** and blocked on the owner's platform access (D2).

## Identity — the part that makes it safe

This process connects to Postgres **directly** as the dedicated, non-`BYPASSRLS` **`agent`**
role via `AUTOMATION_DATABASE_URL`. Never through PostgREST, never as `service_role` — S2-09
revoked `service_role`'s `EXECUTE` on both runtime functions precisely so the easy path is
closed (§9.1, §8.8a).

A direct connection carries no JWT, so `auth.uid()` is null and `is_staff()` is false for this
process no matter what. On a real stack it cannot even *call* `is_staff()` — there is no
`EXECUTE` grant — which `Database.whoami()` reports as `is_staff: null`. The policies that
apply are the ones keyed on `current_user = 'agent'`.

What the role may do is enumerated in migration 34 and nowhere else. What it may never do is
`docs/security.md` §9.4, and `tests/test_privileges.py` proves each line **by refusal**, not by
row count — an RLS policy matching nothing returns zero rows and proves nothing.

## Running it

```bash
cp .env.example .env    # fill in AUTOMATION_DATABASE_URL
pip install -e ".[dev]"

shosho-automation whoami      # what the database thinks this connection is
shosho-automation run-once    # claim whatever is queued, run it, close it
shosho-automation schedule accounting --payload '{"period_start":"2026-09-01","period_end":"2026-09-30"}'
```

`ANTHROPIC_API_KEY` is optional. It is the owner's action **D3** and is not provisioned yet;
with no key the Accounting agent still computes and writes every figure (they come from SQL,
not from the model) and records `narrative_status: "skipped"`.

Health endpoint, for C5's container healthcheck:

```bash
uvicorn shosho_automation.api:app --host 127.0.0.1 --port 8200
```

## Checks

```bash
ruff check . && ruff format --check .   # what CI runs
pytest -q                              # includes a mypy gate, see below
```

`.github/workflows/ci.yml`'s `python (automation)` job runs ruff and pytest but **no type
check**, and that file is S1's (D-004). So `tests/test_typecheck.py` runs `mypy` from inside
pytest — the existing job therefore enforces types without the workflow being edited. If S1
adds a `mypy .` step, that test file can be deleted.

## Reproducing the local verification

Staging and production verification were **out of scope** for S5-01: the `agent` role has no
password until S1's step **C5**, which is itself blocked on the owner's Anthropic key (D3). So
everything was verified against a local Postgres with migrations 1..34 applied verbatim.

The host this was built on (macOS 12) has no Homebrew bottles and no running container
runtime, so the stack was the `pgserver` PyPI package — a wheel carrying PostgreSQL **16.2**
binaries. Grant, column-privilege and RLS semantics are identical to 17 for everything proved
here; the version difference is recorded rather than hidden.

Two things had to be faked, and only these two:

1. **A Supabase bootstrap** — the `auth`/`extensions`/`storage`/`realtime`/`vault` schemas, the
   `anon`/`authenticated`/`service_role` roles, `auth.uid()`, and the `supabase_realtime`
   publication. The migrations themselves are applied **unmodified** from the repo.
2. **`pgcrypto`** — pgserver bundles none, and the migrations use exactly one function from it
   (`gen_random_bytes`, for guest tracking tokens, which no test here exercises).

Neither fake is committed: both live in the session scratchpad and inside the gitignored
`.venv`. Then:

```bash
export AUTOMATION_TEST_DATABASE_URL=postgresql://agent:<local-password>@127.0.0.1:5432/shosho_local
pytest -q tests/test_privileges.py
```

Without that variable the privilege tests skip, so `pytest -q` is green in CI (which has no
database) while still running every other test.

**Set the local `agent` password out of band** (`alter role agent with password …`) — no
migration sets one, and no password, local or otherwise, belongs in this repo.

## What is deliberately not here

- **No second agent.** Grow is C6, Warehouse C9 (needs C8's stock schema), Sales C10 (needs the
  owner's Meta app). Quality is deferred.
- **No sending.** D-017: there is no SMTP and no push transport, so an agent writes rows and
  nothing else. No webhook out either.
- **No new table, no schema change.** Schema is S2's.
- **No external route.** See `api.py` — unauthenticated ingress is how TETA+PI's
  `mcp.tetapi.dev` hole happened.
- **No analytics or events table.** D-015.
- **No write to `agent_outputs.status` / `reviewer_id` / `reviewed_at`.** Those are the human's,
  via `review_agent_output()`, which this role has no grant on at all.

## Known gap this app reports rather than papers over

A German VAT return needs net and tax split **by rate**. That split is **not derivable** from
the tables the `agent` role may read, for two independent reasons:

1. `order_items` snapshots no rate, so the rate is only reachable by joining `menu_items` — and
   `agent` has no `SELECT` grant there (migration 34 grants `orders`, `order_items`,
   `payment_events`, `payment_jobs`, and deliberately not `menu_items`).
2. Even with that grant the join answers the wrong question: the rate is read **live** at order
   time (`rpc.sql:237`) and on operator edit (`…14_update_order_items.sql:119`), and it is
   mutable — owner action **D9** will change every rate. Joining today's `menu_items` would
   price a historical order at today's rate.

So the agent reports `orders.vat_cents` — the VAT each order was **actually charged**, per each
item's own rate (D-019) — and marks `vat_breakdown_by_rate.available = false` with the reason.
It does not assume 7, does not assume 19, and does not branch on delivery vs pickup.
`resolve_vat_breakdown()` already computes a real split the moment one becomes derivable, and
reconciles it against the charged total rather than trusting its own join.

Both points are filed to S2/S7 in `memory/log.md` (S5-01). The honest fix is a rate snapshot
column on `order_items`, written at order time.
