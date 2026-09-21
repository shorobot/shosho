import type { MenuItem } from "./types";

/** "Philadelphia Deluxe" + "RL-014" → "philadelphia-deluxe-rl-014". menu_items has no slug column (§5 gap). */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function itemSlug(item: Pick<MenuItem, "name_en" | "sku">): string {
  return `${slugify(item.name_en)}-${item.sku.toLowerCase()}`;
}

/** Resolves by the SKU suffix so renamed items keep old links working. */
export function findItemBySlug<T extends Pick<MenuItem, "name_en" | "sku">>(items: T[], slug: string): T | undefined {
  const s = slug.toLowerCase();
  return items.find((it) => s === it.sku.toLowerCase() || s.endsWith(`-${it.sku.toLowerCase()}`));
}
