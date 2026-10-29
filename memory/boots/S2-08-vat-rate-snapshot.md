# BOOT: S2-08 (Backend) — snapshot the VAT rate on the order line, before D9 makes today's rates unrecoverable

## Role
You are session S2 (Backend). This boot implements **D-022**, and it is the one item in the plan with a
**closing window**: owner action **D9** sets the real 7 % / 19 % rates per menu item with the
Steuerberater, and **every order placed before this migration exists loses its true rate the moment D9
runs** — irrecoverably, because nothing anywhere records the rate an order actually used.

D9 is blocked on you. The Steuerberater is an external person with their own lead time, so the sooner
this lands, the sooner that conversation can start.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in
`/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2` run `git fetch origin && git checkout -f -B s2-08 origin/main`.
Use `checkout -f`, not `reset --hard`. Never touch another session's worktree; never bare `git stash`.

Read first: `memory/decisions.md` — **D-022** (this decision, with its measurements), **D-019** (the rate
is a per-item property; order type does not change it), **D-012** (findings go to S7).

### What S0 measured, so you do not re-derive it
- **35 migrations; yours is 36.** `S7-04-column-grants-sweep.md` will also produce a migration for you to
  apply afterwards — **coordinate the number through S0**, do not assume you are the only writer.
- **`order_items` snapshots `name`, `unit_price_cents`, `line_total_cents` — but not the rate.** It already
  freezes menu values per line *because they drift*; `item_id` is even `on delete set null` so a deleted
  item leaves the line intact. The rate drifts identically and is the one thing not copied. **This is an
  existing principle applied inconsistently, not a new one.**
- **The rate lives only on `menu_items.vat_delivery_pct`** (`numeric(4,2) not null default 7`, migration 3)
  and is read **live** at calculation time.
- **`orders` keeps only the aggregate `vat_cents`** — no split, no rate.

### The two call sites, and the one that is worse than D-022 recorded
**`quote_order` (`rpc.sql:237`)** accumulates gross-inclusive VAT per line:
```
v_vat_lines := v_vat_lines + v_line_total * it.vat_delivery_pct / (100 + it.vat_delivery_pct);
```
then at `rpc.sql:357-359` applies the discount proportionally and adds the fee's VAT as a **literal**:
```
v_vat := round( v_vat_lines * (v_subtotal - v_discount)/v_subtotal + v_fee * 19.0 / 119.0 )::integer;
```

**`update_order_items` (`update_order_items.sql:119`) repeats the same formula by joining `menu_items`
live.** That is the sharp part and it is **not** only a reporting problem: an operator editing an existing
order today recomputes its VAT against **today's** rates. After D9 that silently rewrites the tax on a
filed order. So the snapshot is a **correctness fix on a live write path**, not just an enabler for a
report.

## Tasks

**1. Migration 36 — the snapshot columns.**
- `order_items.vat_pct numeric(4,2)` — **nullable**. Null means "placed before this migration, rate
  unknowable", and that is a fact to preserve, not a gap to fill.
- `orders.delivery_fee_vat_pct numeric(4,2)` — nullable, same meaning, for the fee's own rate.
- Comment both columns the way migration 4 comments `kitchen_note` — say what they are *for*, so the next
  session does not have to infer it.

**2. Write the rate at order time, in both writers.**
`place_order` and `update_order_items` must store the rate **they actually used** on each line, in the
same statement that writes the line. Not a trigger, not a backfill job: if the rate used and the rate
recorded can ever come from two different reads, they will eventually disagree.

**3. Make `update_order_items` read the snapshot instead of joining `menu_items`.**
This is the correctness half. After this change, editing an old order must reproduce **its own** tax, not
today's. **Prove it with a test that changes a menu item's rate between placing and editing** — that test
is the whole point of this boot and it is the one that would have caught the defect.

**4. Keep the discount proration and the fee exactly as they are.**
The order-level formula applies `(subtotal − discount)/subtotal` to the line VAT and then adds the fee's
share. **Do not "improve" that while you are here** — a rounding change would move historical totals, and
`vat_cents` must stay byte-identical for every existing order. Assert that: re-quote a sample of existing
orders before and after and show the integers are unchanged.

**5. The delivery fee's rate is a literal `19.0 / 119.0` and cannot be changed by D9.**
Snapshot what is used (19), so the fee's tax component becomes derivable. **Do not invent a source for
it** — whether it should come from a setting, and whether 19 % is even correct for a delivery fee, is a
tax judgement for the owner's Steuerberater, not a session's. State it in the report; file it rather than
decide it.

**6. No backfill — and say so in the migration itself.**
Pre-migration rows take `null`. Backfilling by joining today's `menu_items` is **the exact repricing error
this decision exists to prevent**, and it would look like completeness. Any per-rate report states the
split as unavailable for the pre-migration window, with the reason.

**7. Contract.** One new/updated section in `docs/api-contracts.md` covering the two columns, their null
meaning, and that the per-rate split is derivable only from the snapshot forward.

## Boundaries
- **Do not set or change any VAT rate.** D9 is the owner's, with their Steuerberater. You make the rates
  *recordable*; you do not choose them.
- **Do not drop `vat_onsite_pct`** even though it is dead (D-019, B3) and `S7-04` will mention it —
  separate item, separate blast radius.
- **Do not implement `S7-04`'s column grants.** That sweep is S7's ruling and its own migration.
- **Do not touch** `apps/web`, `apps/backoffice`, `apps/automation`, `apps/e2e`, `apps/infra`. If a
  back-office or report surface needs the new split, **file it**; S4 owns those screens.
- Migrations are **append-only**. Do not edit 1–35.
- No secrets in the repo; anon key only.

## Done when
- [ ] Migration 36 adds both nullable columns, commented
- [ ] `place_order` and `update_order_items` both write the rate they used, in the same statement as the line
- [ ] `update_order_items` reads the **snapshot**, not a live `menu_items` join
- [ ] **A test changes a menu item's rate between placing and editing an order, and proves the edit
      reproduces the original tax** — not today's
- [ ] `vat_cents` proven unchanged for a sample of existing orders, as integers
- [ ] Pre-migration rows are `null`, no backfill, and the migration says why
- [ ] The fee's literal 19 % is snapshotted and **filed** for the Steuerberater, not decided
- [ ] `docs/api-contracts.md` section written; `supabase db push` clean; existing tests still green

## Reporting
Append one entry to `memory/log.md` and update **only the S2 row** in `memory/state.md`. Open a PR and
leave the merge to S0 (D-009). Be explicit about:
- anything you measured that **contradicts this boot**, S0's reading of the two call sites included —
  sessions have corrected S0 three times this month and each one mattered;
- anything you could **not** verify, stated as not verified rather than implied;
- what the per-rate split now makes possible, and what it still cannot answer for the pre-migration window.

## Next step after you
**D9 unblocks**: the owner can set the real rates with the Steuerberater without destroying history. That
conversation has external lead time, so S0 will tell the owner the moment this merges. The per-rate split
then becomes real for Berichte (S4) and for the Accounting agent (S5-01), which currently reports charged
VAT and marks the split `available: false` with its reason — correct interim behaviour that should now be
revisited rather than left.
