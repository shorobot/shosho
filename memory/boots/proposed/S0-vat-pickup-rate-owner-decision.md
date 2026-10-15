# OWNER DECISION REQUIRED — pickup VAT: do NOT "fix" 7% to 19% until a tax answer exists

## Status
**Blocking a task S4-05 filed for S2.** S4-05 found, correctly, that the backend charges pickup orders
7% VAT. They filed it for S2 as a backend bug. **That filing must not be executed as written** — acting
on it would very likely overcharge VAT on every pickup order, which is worse than the thing it fixes.

## What is actually in the code, measured 2026-10-15
- `apps/backend/supabase/migrations/20260920000010_rpc.sql:237`
  ```sql
  v_vat_lines := v_vat_lines + v_line_total * it.vat_delivery_pct / (100 + it.vat_delivery_pct);
  ```
  `vat_delivery_pct` **unconditionally**, for every order. Same again in
  `20260921000014_update_order_items.sql:119` (`mi.vat_delivery_pct`).
- `v_type` (the order type) is branched on exactly once in that function — line 271, for the **delivery
  fee**. Never for VAT.
- Defaults (`20260920000003_menu.sql:41-42`): `vat_delivery_pct` **7**, `vat_onsite_pct` **19**.
- **`vat_onsite_pct` is read by nothing in the backend.** The only references outside its own column
  definition are in the back-office menu editor (`components/menu/ItemEditor.tsx:34,64,192,319`, which
  offers an operator a 7 % / 19 % dropdown) and one test.
- `order_type` is `enum ('delivery', 'pickup')` — **there is no dine-in / on-premises type**
  (`20260920000001_enums.sql:8`).

## Why the "fix" is the dangerous direction
German VAT on food turns on *where it is consumed*, not on how it was ordered: the reduced rate applies
to food supplied for taking away or delivery, and the standard rate to consumption on the premises with
the accompanying service. SHOSHO sells delivery and pickup only — **it has no on-premises channel at
all**. On the ordinary reading, 7 % on pickup is therefore *correct*, and `vat_onsite_pct` is
configuration for a dine-in product that does not exist.

So S4's finding describes the code accurately and draws the wrong conclusion from it. Changing pickup to
19 % would add 12 points of tax to every Abholung order on a German storefront operated by a GmbH.
**That is a tax exposure and a customer-overcharge, and it is not a decision any session should take** —
including S0. I am not a tax adviser and this file is not advice.

## Where this came from — S0's error
`boots/S4-05-cash-vat-berichte-einstellungen.md` task 2 states: *"Pickup VAT is computed at 19 %
server-side from `menu_items.vat_onsite_pct` and is correct — only the label is wrong."* **Both halves
are false.** It is not computed from that column, and it is not 19 %. I asserted a mechanism I had not
read. S4 read the code, found the contradiction, and reported it rather than trusting the boot — which
is the behaviour the boots ask for, and it worked.

Note what the label was doing: `detail.vat` said "incl. 7% VAT", and on pickup orders **it was telling
the truth**. S4's fix — render whatever rate the order actually used — is right either way, and is the
reason this is a question about the backend rather than a live mis-statement to customers.

## The decision the owner has to make
1. **Is 7 % correct for Abholung at SHOSHO?** Needs the restaurant's tax adviser (Steuerberater), not a
   session. If yes: nothing in the backend changes.
2. If yes, then **`vat_onsite_pct` is dead config with a live control.** An operator can set it to 19 %
   in Speisekarte and nothing happens — a setting that silently does nothing is exactly the class of bug
   S4-04 was told to render as "unavailable" rather than fake. Either remove the control or mark it as
   reserved for a future dine-in type. **S4's, small.**
3. If a dine-in channel is ever planned, `order_type` needs a third value and the VAT branch needs to
   exist — a real S2 piece of work, specified then, not now.

## Until the owner answers
- **S2 must not change the VAT computation.** Tell S2 the filing is on hold and why.
- S4's label fix stands and should merge — it displays the real rate under every outcome above.
- Nothing is wrong with customers' invoices today *if* 7 % is right; if it is not, every pickup order
  ever placed is under-charged VAT and that is an accounting matter for the owner, not a code fix.
