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
