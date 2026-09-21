# Proposal — S3-03: banners, DE toggle, PWA, favourites

- **Banners**: hero carousel from the `banners` table (slot, date range, deep-link) once S2-02 / S4 create it;
  today the hero is static (only "from … €" is live).
- **i18n DE toggle**: every string already has a `*_de` twin in the DB (`name_de`, `description_de`, option
  `name_de`, quote line `name_de`/`option_de`). UI copy would move to a small dictionary (EN/DE), toggle in the
  header, `lang` on `<html>`, legal pages stay DE.
- **PWA**: manifest + service worker for the mobile bottom-bar flow (installable, offline menu snapshot), push
  for order status (needs S2-02 realtime for guests + a push consent per Datenschutz).
- **Favourites** ("Saved" tab in the mobile design): localStorage in v1, per-customer once accounts exist.
- **Realtime tracking**: replace the 15 s poll with the token-scoped realtime channel from S2-02.
