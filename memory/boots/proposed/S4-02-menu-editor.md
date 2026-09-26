# S4-02 (proposed) — Speisekarte + Artikel editor

Next boot for S4 after S4-01. Screens **BO · Speisekarte** and **BO · Artikel**; contract §6.5
(direct CRUD on `menu_categories`, `menu_items`, `option_groups`, `options`,
`menu_item_option_groups` for operator/owner).

Scope:
- Kategorien: drag-sort, kana names, `schedule` editor (the lunch window), active toggle, the
  "Kategorie ist leer" state from BO · Zustände.
- Artikelliste: price, cost, margin, sold, availability toggle, **Stoplist bis Mitternacht**
  (`stoplist_until = today`), incomplete-data flags, bulk actions, search.
- Artikel editor: DE/EN + kana + transliteration, description, category, price, SKU,
  availability/stock/max per order, tags, kitchen (prep minutes, station, note), legal (allergens
  A–N, weight, kcal, VAT 7/19), option groups (shared vs item-only; any / exactly one / 0–3),
  recommended items, preview, margin.
- Photos stay **disabled** until the `menu` storage bucket exists (§6.5, S2-02).

Depends on: nothing new. Touches only `apps/backoffice`.
