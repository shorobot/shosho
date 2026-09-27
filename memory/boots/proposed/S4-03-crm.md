# S4-03 (proposed) — Kunden (CRM list) + Profil

Screens **BO · Kunden** and **BO · Profil**; contract §6.4 (`customers`, `customer_addresses`,
view `customer_stats`).

Scope:
- Segmente: Stammkunden (3+), neu diesen Monat, schlafend (60+ Tage), Firmen — from `customer_stats`.
- Liste: sort by orders / spend / avg / last order, tags VIP/ALLERGIE/KATERING/PROBLEM, bulk tag and
  CSV export (push/voucher need S5), the "Noch kein Kundenprofil" empty state.
- Profil: contacts, addresses, **Küchennotiz** (the allergy note that snapshots onto every order),
  GDPR consents with date + source, export/delete data, stats, top items, and the real timeline —
  `customer_events` shipped with S2-02, so the stand-in is no longer needed: read it per §6.8 and add
  entries with `rpc('add_customer_event')` (complaint / compensation / note / push_opened). It is in
  the realtime publication, so an open profile can subscribe the way the orders board does.
- Wires the detail screen's "Im CRM öffnen →" link, which is a placeholder after S4-01.

Depends on: §6.4 + §6.8 as written — nothing outstanding.

Refreshed after S4-02 (2026-09-27):
- `customer_stats` counts **completed orders only** (§1.2, S0's ruling); S2-03 adds `cancelled_count`
  for the PROBLEM tag. Build the segments against that, not against raw order counts.
- Reuse what S4-02 built: `lib/menuStore.tsx` is the pattern for "one load + `run()` write guard",
  `components/menu/Fields.tsx` is the form vocabulary (label/field/switch/chips/money), and
  `BulkBar` + `UndoBar` are the shape for the CRM's bulk tag / export — one confirmed request with a
  snapshot to undo, never a per-row loop.
- On-request erasure for a single customer is still not in the contract (§6.8 GDPR note) — surface
  the request, do not invent an RPC.
