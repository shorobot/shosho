# BOOT: S4-02 (Back-office) — Speisekarte, Artikel editor, photo upload

## Role
You are session S4 (Back-office) of SHOSHO. This boot gives the restaurant control of its own menu: categories, items, option groups, availability, the stoplist, and — new since your proposal — **real photo upload**, because S2-02 created the `menu` storage bucket.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s4` run `git fetch origin && git checkout -b s4-02 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s4-02` → `main`. Repo language English; UI German primary with the EN toggle you built.
Read FIRST: `/memory/state.md`, `/memory/decisions.md`, `/docs/api-contracts.md` **§6.5** (menu CRUD) and **§6.8** (photo upload — `storage.from('menu').upload`, paths `menu/<item_id>/<n>.jpg`, 5 MB, jpeg/png/webp/avif, owner/operator only), §1.2 for the schema. Then the canvas screens **BO · Speisekarte** and **BO · Artikel**, and the "Kategorie ist leer" / "Unvollständig" states in BO · Zustände. Your own proposal `/memory/boots/proposed/S4-02-menu-editor.md` — accepted; delete the file in your PR.

Your S4-01 contract gaps are answered in §6.9 and are being implemented by S2-03 in parallel. Nothing in this boot depends on them; if a §6.9 item lands mid-flight, use it, do not wait.

## Tasks
1. **Speisekarte** `/menu`:
   - Categories panel: list with kana and item counts, drag to sort (persist `sort`), create/rename/deactivate, the `schedule` editor for the lunch window (`{days:[1..5], until:"15:00"}`) with a plain weekday+time UI, and the design's note that an empty or inactive category is hidden from the site.
   - Items table: photo thumb, name + kana, category, price, cost, **margin %**, sold (from the reports view if S2-03 has shipped it, otherwise omit the column rather than faking it), availability toggle, **Stoppliste bis Mitternacht** (`stoplist_until = today`), and the "unvollständig" flags the design shows (missing EN name/description, missing photo, missing allergens).
   - Filters (Alle / Aktiv / Stoppliste / Unvollständig), search, and bulk actions on a selection: price ±%, move category, hide, stoplist, duplicate. Every bulk action must be a single confirmed operation with a clear undo path (re-running the inverse), never a silent loop.
2. **Artikel editor** `/menu/item/[id]` (and `/menu/item/new`), matching the design's sections: Basis (name DE/EN, kana, transliteration, descriptions, category, base price, SKU), Fotos (task 3), Verkauf (available, stoplist until midnight, stock, max per order, tags new/hit/spicy/vegetarian), Küche (prep minutes, station, note), Recht (allergens A–N as the German scheme, weight, kcal/100 g, VAT 7 % delivery / 19 % on-site), Optionen (link shared groups or create item-only ones; rules any / exactly one / 0–3 with min/max/required), Empfohlen dazu (`recommended_item_ids`), live Vorschau (card + detail) and the margin/`sold` panel. Unsaved-changes guard, explicit Save, Duplizieren.
3. **Photos** — the real thing now:
   - Upload to bucket `menu`, path `menu/<item_id>/<n>.<ext>`; client-side resize/compress before upload (target ≤ 1600 px long edge, ≤ 1 MB) so the 5 MB limit is never the constraint and the storefront stays fast; accept jpeg/png/webp/avif, reject the rest with the reason.
   - Reorder (first photo = card image), replace, delete (delete the object too, not just the reference), and keep `menu_items.photos` in sync as bucket-qualified paths exactly as §6.8 states.
   - Show the separate crops the design mentions (card vs detail) — if a real crop tool is too much for this boot, ship a focal-point picker and say so; do not silently ignore the requirement.
   - Errors: upload failure, oversized file, wrong type, storage policy denial (kitchen/driver must not even see the control).
4. **Option groups** `/menu/options`: list shared groups with their usage count, create/edit (name DE/EN, min/max/required, options with price and sort), and **warn before saving a shared group** that the change affects N linked items (the design says exactly this). Item-only groups are edited inside the item.
5. **Guards**: every write is operator/owner only — hide the controls for kitchen/driver and handle a denial from RLS gracefully if someone forces it. Nothing here may use the service-role key.
6. **Tests**: vitest for the pure logic (margin, completeness flags, option-rule validation, bulk price math, photo path building); extend the Playwright smoke if it runs in your environment — if browsers still cannot install on this Mac, document the local recipe as you did in S4-01 rather than shipping a workflow that only works elsewhere.
7. **Verify against staging** with the operator login: create a category, create an item with two option groups and a real uploaded photo, put it on the stoplist and confirm it disappears from `https://shos.hellfiresol.com/`, take it off and confirm it returns. Write what you saw in the log — this is the acceptance test for the whole boot.
8. **Docs**: extend `apps/backoffice/README.md` (routes, roles, photo pipeline). Gaps in §6.5/§6.8 → append to `/memory/boots/proposed/S4-contract-request.md` (do not edit the contract).

## Boundaries
- Do NOT build Kunden/CRM, Website/CMS, Marketing or Berichte (S4-03, S4-04, later).
- Do NOT touch `apps/backend` (migrations, RPCs) or `apps/web`. Need a backend change → proposal.
- Do NOT edit `/docs/api-contracts.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT add a container or a service — the staging slice has ~250 MB of real headroom for three containers and S1 is working on it (S1-04). Your app stays one container.
- Do NOT add a fifth colour or another font. No analytics.
- No secrets in the repo; anon key + user session only.

## Done when
- [ ] Categories: sort, schedule, activate/deactivate, empty state
- [ ] Item table with filters, search, bulk actions, stoplist, completeness flags
- [ ] Item editor covers every section of the design and saves correctly
- [ ] Photo upload/reorder/replace/delete works against the `menu` bucket and the storefront shows the photo
- [ ] Shared option groups warn about linked items
- [ ] kitchen/driver cannot see or perform menu writes
- [ ] The staging walk-through in task 7 done and written up
- [ ] `node (backoffice)` CI green; PR `s4-02` merged

## Reporting
1. `/memory/log.md`: `## <date> — S4 Back-office — S4-02` — what shipped, the staging walk-through result, image sizes/RAM if they changed, gaps, blockers.
2. `/memory/state.md`: ONLY the S4 row.
3. Commits `[S4-02]`.

## Next step
S4-03 (CRM) and S4-04 (settings + website CMS) proposals already exist — refresh them if this boot changed anything. Do not execute. After reporting — stop and wait for S0.
