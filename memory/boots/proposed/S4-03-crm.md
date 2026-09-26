# S4-03 (proposed) — Kunden (CRM list) + Profil

Screens **BO · Kunden** and **BO · Profil**; contract §6.4 (`customers`, `customer_addresses`,
view `customer_stats`).

Scope:
- Segmente: Stammkunden (3+), neu diesen Monat, schlafend (60+ Tage), Firmen — from `customer_stats`.
- Liste: sort by orders / spend / avg / last order, tags VIP/ALLERGIE/KATERING/PROBLEM, bulk tag and
  CSV export (push/voucher need S5), the "Noch kein Kundenprofil" empty state.
- Profil: contacts, addresses, **Küchennotiz** (the allergy note that snapshots onto every order),
  GDPR consents with date + source, export/delete data, stats, top items, and the customer's orders
  as the timeline stand-in (`customer_events` is S2-02).
- Wires the detail screen's "Im CRM öffnen →" link, which is a placeholder after S4-01.

Depends on: §6.4 as written. `customer_events` (S2-02) would upgrade the profile timeline.
