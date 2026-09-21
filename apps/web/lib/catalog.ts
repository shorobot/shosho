import { cache } from "react";
import { getApi } from "./api";
import type { Catalog } from "./types";

/** Per-request memo for server components (layout + page share one fetch). */
export const getCatalog = cache(async (): Promise<Catalog> => (await getApi()).getCatalog());

/** Categories that have at least one on-sale item (product rule: hide empty categories). */
export function visibleCategories(c: Catalog) {
  const counts = new Map<string, number>();
  for (const it of c.items) counts.set(it.category_id, (counts.get(it.category_id) ?? 0) + 1);
  return c.categories.filter((cat) => (counts.get(cat.id) ?? 0) > 0).map((cat) => ({ ...cat, count: counts.get(cat.id) ?? 0 }));
}
