# S4-04 (proposed) — ~~Einstellungen + Website (CMS)~~ → **Einstellungen only; the Website half shipped**

> **Status 2026-10-11.** The **Website (CMS)** half of this proposal is **done** — shipped in boot
> S4-04 (branch `s4-04`), which S0 issued on 2026-10-10 against §8 rather than against this file.
> The **Einstellungen** half is still open and is the next boot (**S4-05**, together with Berichte).
> The Website text is struck through below rather than deleted, because two of its notes turned out
> to be wrong in ways worth keeping — see "What this proposal got wrong" at the end.

Screens ~~**BO · Einstellungen** and **BO · Website**~~ **BO · Einstellungen**; contract §6.6
(settings rows by key, owner write; team = `staff` rows) and the parts of §6.7 that S2-02 unlocks.

Scope (Einstellungen) — **still open, S4-05**: team & roles (invite flow — documented manually in
S4-01, automate with an Edge Function calling the Auth admin API), notifications (sound, auto-print,
overdue warning, daily report), operations (prep 22 min, rush +15, pre-order days, auto-accept
threshold, allow pause), payments (read-only view of what D-011 configures), legal (Impressum,
USt-IdNr, retention), language, timezone, danger zone.

~~Scope (Website): opening hours, business data, **delivery zones** (A/B/C areas, min order, fee,
promised minutes, postal codes), SEO, cookie banner, robots, maintenance mode. Banners, publish
history and the unpublished-changes counter need new tables (§6.7) — either S2-02 adds them or this
boot ships without them.~~ — **all of it shipped in S4-04.** S2-06 had already added the tables
(§8.6/§8.7: `banners`, `banners_live`, bucket `site`, `settings.draft`, `publish_site()`,
`site_publications`), so nothing had to ship without them.

Depends on: an owner-only UI is easy; the **invite** flow needs a service-role path (Edge Function),
which must not live in this app (anon key only). Coordinate with S2. **Still true, and still the one
hard blocker on the Einstellungen half** — S4-04 did not touch it.

Refreshed after S4-02 (2026-09-27):
- §6.9 grants every authenticated staff role read access to the public settings keys **plus `ops`**,
  and adds a `staff_directory` view (`id, name, role, active`) — both implemented by S2-03. The
  Einstellungen screen should read team members through the view and keep the base `staff` table
  (phone, PII) owner/operator. **Still applies to S4-05.**
- `settings.kitchen.capacity` (default 8) arrives with S2-03; the shell's kitchen-load placeholder
  becomes real once it exists, and Einstellungen is where it is edited. **Still applies to S4-05.**
- ~~Reuse `components/menu/Fields.tsx` for the forms and `lib/menuStore.tsx`'s `run()` for the RLS
  denial message — settings are owner-write, so an operator opening the screen must see it read-only
  rather than a Postgres error.~~ — **done, and worth copying into S4-05 verbatim.** S4-04 did exactly
  this; `components/website/SettingSection.tsx` + `useSettingDraft.ts` are the reusable shape.

## What this proposal got wrong, found by building it (kept for S4-05)

1. **`run()` alone is not enough for an owner-write table.** This file said an operator must "see it
   read-only rather than a Postgres error". There is no Postgres error: `settings_owner_write` is the
   only write policy on `settings`, so an operator's `update` is RLS-filtered to **zero rows and
   returns `{ data: [], error: null }`** — a silent success. Verified against `shosho-staging` during
   S4-04. `run()` reports only `error`, so the screen would have toasted "saved" for a write that
   never happened. The fix is `lib/write.ts`'s `wrote()` on every write, with `.select(...)` on the
   query. **S4-05 must do the same for every Einstellungen field**, which is essentially the whole
   screen — it is all `settings`.
2. **Delivery zones are not a `settings` key.** This file listed them under Website scope as though
   they were. `delivery_zones` is its own table, has no `draft` column, and is owner/**operator**-write
   rather than owner-only — so zone edits go live immediately while the rest of that screen is
   staged. Shipped with the UI saying so; filed as contract-request 19 for a ruling.
