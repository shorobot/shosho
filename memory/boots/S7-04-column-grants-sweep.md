# BOOT: S7-04 (Security) — RLS is row-level: sweep every public-read table for columns that were never narrowed

## Role
You are session S7 (Security) of SHOSHO. You **rule and audit; you do not implement** — the migration is
S2's (D-012). This boot exists because S0, while scoping a different finding, measured a **live** one.

**Read this first and do not re-derive it.** `anon` — no account, using the public key the guest site
ships in every page view — can read `menu_items.cost_cents` on the deployed staging site **right now**:

```
GET /rest/v1/menu_items?select=sku,base_price_cents,cost_cents  →  200
  ON-001 Onigiri Trio 750 / 210 · MN-001 Misosuppe 320 / 60 · MN-002 Wakame-Salat 450 / 90
```

That is the shop's cost structure and margin. The JWT was confirmed to carry `role: anon`.

**Scope it honestly in your report, as S0 did in D-025: this is staging with seed data.** Those numbers
are fictional. The **mechanism** is real and production would ship the same schema, so this is
*fix before production*, **not an incident now**. Do not inflate it, and do not deflate it either.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in
`/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s7` run `git fetch origin && git checkout -f -B s7-04 origin/main`.
Use `checkout -f`, not `reset --hard`. Never touch another session's worktree; never bare `git stash`.

Read first, in this order:
1. `memory/decisions.md` — **D-025** (this finding, with the measurements), **D-024** (the same defect
   class from the other side), **D-012** (findings go to S7; S7 rules, the owning session implements).
2. `apps/backend/supabase/migrations/20260920000009_rls.sql` — the six public-read policies.
3. `apps/backend/supabase/migrations/20261006000032_publish_and_funnel_fix.sql` lines 12-24 — the **only**
   column narrowing that has ever been written here, and its comment explaining the pitfall. It is the
   template; it is known-good.

### The mechanism, so the sweep is aimed correctly
**RLS decides which rows. It does not decide which columns.** Columns are controlled by `GRANT`. A role
holding a blanket table grant sees **every column of every row a policy admits**. So a policy can be
perfectly correct and still expose a column.

- `items_public_read` is `for select to anon, authenticated using (public.menu_item_on_sale(menu_items))`
  — correct at the row level, and not the bug.
- Repo-wide, `grant select (…)` appears **exactly once** across all 35 migrations. Every other
  public-read table was never narrowed.
- **Six tables** carry a public-read policy admitting `anon, authenticated` with **no `is_staff(…)`**
  predicate: `settings`, `delivery_zones`, `menu_categories`, `menu_items`, `option_groups`, `options`.
  `menu_items` is the one with money on it (`cost_cents`) and staff text (`kitchen_note`).
- **The technique already works here**: as `anon`, `settings?select=draft` returns `42501` naming the
  exact missing privilege. Copy that shape; do not invent a second one.
- **Controls, so you do not over-read the result**: `customers` and `orders` return `[] 200` for `anon`.
  They are protected at the **row** level and are **not** part of this finding.

## Tasks

**1. Sweep all six public-read tables, column by column, and produce a ruling table.**
For each table, every column gets exactly one verdict: **public** (the guest site genuinely renders it),
or **not public** (narrow it). Do not guess what the storefront needs — **measure it**: `apps/web` names
its columns explicitly (`lib/api-supabase.ts` and its callers), so the set it actually selects is
discoverable. A column no public consumer names is not public.
Your own helpers are the cheap way in: `security_audit_policies`, `security_audit_table_grants`,
`security_audit_function_grants`.

**2. Write the exact grant statements for S2, and prove each one against a live probe.**
Mirror migration 32's shape: `revoke all on table public.<t> from anon;` then
`grant select (<public columns>) on public.<t> to anon;`. For **each** table state the before/after
you observed with the anon key — the column that leaked, and the `42501` that replaces it.
**Pair every probe with a control**, as D-025 did: a single error response cannot tell "narrowed" from
"table gone" or "column misspelled". A probe without a control is not a measurement.

**3. Rule D-024 in the same sweep — it is this defect seen from the other side.**
There the over-broad grant belongs to **`authenticated`**, and the column is `settings.draft`. The
complication, which is why it needs a ruling and not just a grant: `authenticated` includes
**owner/operator, who legitimately need `draft`**, and `settings_public_read` is the one `to authenticated`
policy carrying no `is_staff(…)` test. So the fix must separate staff from non-staff `authenticated`
without breaking the CMS. State the options and pick one, with the reasoning.
**This is a phase-B release blocker**: phase A put the machinery in the database but no login screen
exists, so no customer JWT exists in normal use. Phase B creates the first one.

**4. Restate the invariant that failed, so it stops being repeated.**
The customer-accounts ROADMAP claims the backend is "safe by construction against a second class of
authenticated user", resting on "every `to authenticated` policy carries an explicit `is_staff(…)`".
**`settings_public_read` is the exception**, and column grants are where it bites. Write the invariant
with its exception named, in `docs/security.md`, so the next session inherits the true version.

**5. Say what else the sweep touches, without fixing it.**
`menu_items.vat_onsite_pct` is exposed **and** is dead per D-019 (B3 removed its control). Dropping it is
better than narrowing it — but that is S2's migration and S2's call. Note it; do not do it.

## Boundaries
- **Audit and rule only. Write no migration, no policy, no grant.** The implementation is S2's (D-012).
  Your deliverable is the ruling plus the exact statements S2 will apply.
- **Do not touch** `apps/backend`, `apps/web`, `apps/backoffice`, `apps/automation`, `apps/e2e`, `apps/infra`.
- **Probe read-only, with the anon key only.** Never write to staging; never request or use the gate
  credential or any staff password; never print a key into the repo or the report.
- **Do not edit** `memory/decisions.md`, `memory/plan.md`, `memory/sessions.md`, or another session's row.
  `docs/security.md` is yours for task 4.
- If you find a **further** finding mid-sweep, file it; do not widen this boot to chase it.

## Done when
- [ ] All six public-read tables swept, with a per-column **public / not public** verdict and the evidence
      for each "public" claim taken from what `apps/web` actually selects
- [ ] Exact `revoke`/`grant` statements written for S2, per table
- [ ] Every claim backed by a live probe **with a control**, before and after reasoning stated
- [ ] `menu_items.cost_cents` specifically: the leak reproduced, and the statement that closes it
- [ ] **D-024 ruled** — how to keep `draft` from non-staff `authenticated` without breaking owner/operator
      or the CMS, options stated, one chosen with reasons
- [ ] The "safe by construction" invariant restated **with its exception** in `docs/security.md`
- [ ] `vat_onsite_pct` noted for S2, not acted on
- [ ] Scope stated honestly: staging, seed data, mechanism real — fix before production, not an incident

## Reporting
Append one entry to `memory/log.md` and update **only the S7 row** in `memory/state.md`. Open a PR and
leave the merge to S0 (D-009). Be explicit about:
- anything you measured that **contradicts this boot**, S0's D-025 included — that has been the most
  valuable half of every report in this project, and two of S0's rulings this month were corrected by the
  sessions they were issued to;
- anything you could **not** verify, stated as not verified rather than implied;
- whether any of the six tables turned out to need **no** change, which is a real result, not a gap.

## Next step after you
S2 applies the statements as one migration (the next free number — 35 is taken by customer accounts, and
D-022's VAT-rate snapshot is also queued for S2, so coordinate the numbering through S0). **D-024 must be
closed before ROADMAP phase B (S3-04, the login UI) is issued** — S0 is holding that sequencing.
