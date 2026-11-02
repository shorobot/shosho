# FOR THE D9 CONVERSATION — two VAT questions the snapshot surfaced, neither a session's to answer

## Status
**Filed by S2-08 (PR #115, D-022), not decided.** The `order_items.vat_pct` /
`orders.delivery_fee_vat_pct` snapshot has landed, so **D9 is unblocked**: the owner can now set the
real 7 / 19 rates per menu item with the Steuerberater without destroying the rate history of every
order already placed.

While implementing it, two things turned up that are **tax judgements, not code decisions**. Both are
cheap to ask while the Steuerberater is already engaged for D9, and expensive to discover afterwards.
Neither is a bug in the snapshot; both are questions the snapshot makes *visible* for the first time.

**Companion file:** `S0-vat-pickup-rate-owner-decision.md` — the pickup-rate question (is 7 % correct
for Abholung, and is `vat_onsite_pct` dead config?). That one is still open and is **not** restated
here. Same adviser, same conversation; worth putting all three in front of them at once.

## Question 1 — is the delivery fee 19 %, and should that rate live in a table?

Measured in `quote_order` (`rpc.sql`, totals block):

```sql
v_vat := round( … + v_fee * 19.0 / 119.0 )::integer;
```

The fee's VAT rate is a **literal in SQL, readable from no table at all.** Two consequences:

- **D9 cannot change it.** Setting the real rates per menu item does nothing to the delivery fee —
  that needs a **code change and a migration**, which is a different kind of task with a different
  lead time. If the Steuerberater's answer moves the fee's rate, somebody has to be told to ship it.
- S2-08 **snapshots the rate that is used** (`orders.delivery_fee_vat_pct`), so the fee's tax
  component is at least derivable from here on, and the literal is now named once
  (`v_fee_vat_pct`) rather than written twice. **S2-08 did not give it a source**, deliberately:
  inventing a settings key implies an answer to the question below.

**The question for the Steuerberater:** is a delivery fee charged by a restaurant delivering its own
food taxed at 19 %, or does it follow the reduced rate of the food it delivers? (The second reading
is not exotic — a delivery charge can be treated as ancillary to the supply it serves.) **S0 is not
the authority on this and neither is S2.**

**If the answer is "it depends on the food," note the shape of the work:** the current model has one
rate for the whole fee, so a mixed-rate basket would need the fee's VAT apportioned across rates.
That is a real piece of S2 work, specified *after* the answer, not before.

## Question 2 — on an invoice, must the per-rate amounts sum to the order's total VAT?

`orders.vat_cents` is rounded **once, at the end**, after the discount proration. A per-rate split
rounds **once per rate** and then sums. These do not always agree.

**Measured on 11 sample orders with mixed 7 % / 19 % lines: 3 of 11 differed, by 1 ct.** Example
(single-rate, so not even a mixed-basket artefact): line VAT 201.49 ct + fee VAT 46.30 ct → rounded
once = **248**; rounded separately and summed = 201 + 46 = **247**.

So a German invoice showing tax **per rate** — which is what D-022 recorded as normally expected, and
the reason the snapshot exists — can show per-rate amounts that do not add up to the `vat_cents` the
customer was charged, by a cent.

**The question:** which figure is authoritative on the document — the per-rate amounts, or the total?
And may they differ by rounding, or must one be derived from the other?

**Deliberately not fixed.** Changing the rounding would move `vat_cents` on **existing orders**, and
S2-08's hard constraint was that historical totals stay byte-identical (proven: 11 of 11 unchanged).
Whichever way this is answered, the fix is a **forward-only** change and needs the answer first.

## What is NOT being asked here
- **No rate is being proposed.** D9 sets the per-item rates; this file does not suggest values.
- **No change to the pickup computation** — see the companion file; that filing is still on hold and
  S2-08 did not touch it.
- `vat_onsite_pct` is still read by nothing in the backend and was **not** dropped by S2-08 (separate
  blast radius; `S7-04` mentions it).

## For whoever picks this up afterwards
The per-rate split is derivable **only from migration 36 forward**. For every order placed before it,
the rate is recorded nowhere and **must not be reconstructed** by joining today's `menu_items` — that
reprices a filed period, and it would look like completeness. Reports state the split as unavailable
for that window with the reason, which is what the Accounting agent already does. If the Steuerberater
needs per-rate figures for a period that starts before this migration, **that is the answer to give
them**, not a number.
