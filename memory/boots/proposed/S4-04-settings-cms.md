# S4-04 (proposed) — Einstellungen + Website (CMS)

Screens **BO · Einstellungen** and **BO · Website**; contract §6.6 (settings rows by key, owner
write; team = `staff` rows) and the parts of §6.7 that S2-02 unlocks.

Scope (Einstellungen): team & roles (invite flow — documented manually in S4-01, automate with an
Edge Function calling the Auth admin API), notifications (sound, auto-print, overdue warning, daily
report), operations (prep 22 min, rush +15, pre-order days, auto-accept threshold, allow pause),
payments (read-only view of what D-011 configures), legal (Impressum, USt-IdNr, retention), language,
timezone, danger zone.

Scope (Website): opening hours, business data, **delivery zones** (A/B/C areas, min order, fee,
promised minutes, postal codes), SEO, cookie banner, robots, maintenance mode. Banners, publish
history and the unpublished-changes counter need new tables (§6.7) — either S2-02 adds them or this
boot ships without them.

Depends on: an owner-only UI is easy; the **invite** flow needs a service-role path (Edge Function),
which must not live in this app (anon key only). Coordinate with S2.

Refreshed after S4-02 (2026-09-27):
- §6.9 grants every authenticated staff role read access to the public settings keys **plus `ops`**,
  and adds a `staff_directory` view (`id, name, role, active`) — both implemented by S2-03. The
  Einstellungen screen should read team members through the view and keep the base `staff` table
  (phone, PII) owner/operator.
- `settings.kitchen.capacity` (default 8) arrives with S2-03; the shell's kitchen-load placeholder
  becomes real once it exists, and Einstellungen is where it is edited.
- Reuse `components/menu/Fields.tsx` for the forms and `lib/menuStore.tsx`'s `run()` for the RLS
  denial message — settings are owner-write, so an operator opening the screen must see it read-only
  rather than a Postgres error.
