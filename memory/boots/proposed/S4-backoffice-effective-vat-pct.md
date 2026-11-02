# FOR S4 — `effectiveVatPct` overstates the rate on every delivery order; the snapshot now makes it answerable

## Status
**Found and measured by S2-08 (PR #115, D-022). Not fixed — `apps/backoffice` is S4's, and S2-08's
boot forbids touching it.** Filed rather than executed.

One line **was** changed in `apps/backoffice/tests/orders.test.ts` by S2-08: a `delivery_fee_vat_pct:
null` key in the `order()` fixture, because migration 36 added that column to `orders` and the fixture
is a full object literal, so CI's `node (backoffice)` typecheck fails without it. **Mechanical type
repair, no behaviour and no screen touched** — flagged here and in the PR so S0 can revert it if the
boundary should have been held instead.

## The finding

`apps/backoffice/lib/orders.ts:358` back-infers the VAT rate by inverting the order's total VAT:

```ts
export function effectiveVatPct(o: Pick<Order, "subtotal_cents" | "discount_cents" | "vat_cents">) {
  const gross = o.subtotal_cents - o.discount_cents;
  const net   = gross - o.vat_cents;
  …
  const pct = (100 * o.vat_cents) / net;
```

**`vat_cents` includes the delivery fee's VAT. `gross` does not include the delivery fee.** So on any
order with a fee, the fee's tax is divided by a net that excludes the fee's own value, and the
displayed rate comes out too high. The helper's own comment anticipates sub-cent inversion noise and
mixed baskets — it does not account for the fee at all.

## Measured, on real filed orders (PostgreSQL 16.2, the committed seed, S2-08's harness)

The function reproduced exactly in SQL against 11 filed sample orders:

| order | type | fee | **backoffice displays** | rate the lines actually used |
|---|---|---|---|---|
| `d-ramen2-zoneB-tip` | delivery | 290 | **9 %** | 7 |
| `d-options-phil` | delivery | 290 | **9 %** | 7 |
| `d-mixed-7and19` | delivery | 290 | **16 %** | 7 and 19 |
| `d-mixed-promo10` | delivery | 290 | **16 %** | 7 and 19 |
| `d-ramen2-zoneA` | delivery | 0 | 7 % | 7 |
| `d-ramen3-zoneC` | delivery | 0 | 7 % | 7 |
| `d-freedelivery-35` | delivery | 0 | 7 % | 7 |
| `p-ramen2-pickup` | pickup | 0 | 7 % | 7 |
| `d-odd-cents-19only` | delivery | 0 | 19 % | 19 |
| `d-big-mixed-promo` | delivery | 0 | 11 % | 7 and 19 |
| `p-mixed-promo10` | pickup | 0 | 14 % | 7 and 19 |

**A plain 7 % delivery order is labelled "incl. 9 % VAT".** It is correct only when the fee is 0 and
the basket is single-rate. Worth noting the interaction with
`proposed/S0-vat-pickup-rate-owner-decision.md`: that file established that the *pickup* label was
telling the truth, and that S4's "render whatever rate the order actually used" fix is right under
every outcome. It is — but the current implementation does not yet render that rate on delivery.

Two distinct problems are tangled here:
1. **The fee's VAT is not excluded from the inversion.** A plain arithmetic bug, fixable today without
   migration 36 — `delivery_fee_cents` is already on the row.
2. **A mixed-rate basket has no single "effective rate"** to display at all. The blended 11 % / 14 %
   above is not a VAT rate that exists; it is an average. **This one needs the snapshot.**

## What migration 36 makes possible, and the constraint on using it

From migration 36 forward, `order_items.vat_pct` and `orders.delivery_fee_vat_pct` record the rates an
order actually used, so Detail/Berichte can render **a real per-rate split** instead of one inferred
average: group the lines by `vat_pct`, show net and tax per rate, and show the fee's own rate
separately. See `api-contracts.md` **§1.8**.

**The constraint, and it is not optional.** `vat_pct` is **null for every order filed before migration
36**, which means *the rate is recorded nowhere* — not "look it up". Rendering such an order must say
the split is **unavailable**, with the reason. **Do not join `menu_items` to fill it in**: that prices
a filed order at today's rates, which is the exact error D-022 exists to prevent, and after owner
action **D9** changes the rates it will produce confidently wrong history. The inversion-based
`effectiveVatPct` remains the only thing that can say anything at all about the pre-migration window —
so fixing bug 1 above has value independently of the snapshot, and the two should probably coexist:
snapshot where present, inversion (fee-corrected) where not, labelled as an estimate.

**Also note:** rounding a split per rate does not always sum to the stored `vat_cents` — measured 1 ct
apart on 3 of 11 orders, because `vat_cents` is rounded once at the end. Whether the per-rate figures
or the total is authoritative on a document is a question filed for the Steuerberater in
`proposed/S0-vat-rate-questions-for-d9.md`, **not something to resolve in the UI**.

## Not claimed
S2-08 did not run the back-office app or its test suite (no container runtime on that host, and
`apps/backoffice` has no installed dependencies there). The table above is the **helper's arithmetic
reproduced against real rows**, not a screenshot of the rendered screen. The label text, and whether
`detail.vat` is the only consumer, are unverified.
