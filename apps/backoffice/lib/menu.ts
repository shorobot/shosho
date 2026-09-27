// Pure menu logic (api-contracts §1.2 / §6.5 / §6.8). Everything here is side-effect free so the
// vitest suite can cover the arithmetic the operator trusts: margin, completeness, option rules,
// bulk price math and the storage paths. No React, no Supabase.
import type { Json } from "@/lib/types";

/* ------------------------------------------------------------------ money & margin */

/** Contribution per unit in cents — null when no cost is recorded. */
export function contributionCents(basePriceCents: number, costCents: number | null | undefined): number | null {
  if (costCents == null) return null;
  return basePriceCents - costCents;
}

/** Margin as a percentage of the selling price. Null when cost is unknown or the price is 0. */
export function marginPct(basePriceCents: number, costCents: number | null | undefined): number | null {
  if (costCents == null || basePriceCents <= 0) return null;
  return ((basePriceCents - costCents) / basePriceCents) * 100;
}

/** Bulk "Preis ±%": percentage applied to cents, rounded to the cent, never below zero. */
export function applyPricePct(cents: number, pct: number): number {
  return Math.max(0, Math.round(cents * (1 + pct / 100)));
}

/* ------------------------------------------------------------------ stoplist & availability */

/** Stoplist is a date, not a flag: an item is stopped while `stoplist_until >= today` (§6.5). */
export function isStopped(stoplistUntil: string | null | undefined, today: string): boolean {
  return Boolean(stoplistUntil) && String(stoplistUntil) >= today;
}

/** "On sale" exactly as the DB computes it: available, not stopped, category active (§1.2). */
export function isOnSale(
  item: { available: boolean; stoplist_until: string | null },
  category: { active: boolean } | undefined,
  today: string,
): boolean {
  return item.available && !isStopped(item.stoplist_until, today) && Boolean(category?.active);
}

/* ------------------------------------------------------------------ completeness */

export type CompletenessFlag = "name_en" | "description_en" | "photo" | "allergens";

export type CompletenessItem = {
  name_de: string;
  name_en: string | null;
  description_de: string | null;
  description_en: string | null;
  photos: Json;
  allergens: string[] | null;
};

const blank = (s: string | null | undefined) => !s || !s.trim();

/**
 * The "Unvollständig" flags the design puts on the item row and the editor header: a missing EN
 * name, a missing EN description (only when there is a DE one to translate), no photo, no allergens.
 */
export function completeness(item: CompletenessItem): CompletenessFlag[] {
  const flags: CompletenessFlag[] = [];
  if (blank(item.name_en)) flags.push("name_en");
  if (!blank(item.description_de) && blank(item.description_en)) flags.push("description_en");
  if (photoPaths(item.photos).length === 0) flags.push("photo");
  if (!item.allergens || item.allergens.length === 0) flags.push("allergens");
  return flags;
}

/** Soft hint from the editor ("zweites Foto empfohlen") — not part of the incomplete filter. */
export function wantsSecondPhoto(photos: Json): boolean {
  return photoPaths(photos).length === 1;
}

/* ------------------------------------------------------------------ photos (§6.8) */

export const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type PhotoMime = (typeof PHOTO_MIME)[number];
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // hard bucket limit; the client compresses far below it
export const PHOTO_BUCKET = "menu";

export function isPhotoMime(type: string): type is PhotoMime {
  return (PHOTO_MIME as readonly string[]).includes(type);
}

export function extForMime(type: string): string {
  switch (type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}

/** `photos` is `jsonb`; the contract stores an array of bucket-qualified path strings. */
export function photoPaths(photos: Json): string[] {
  if (!Array.isArray(photos)) return [];
  return photos.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** Object key inside the bucket: `<item_id>/<n>.<ext>` — what storage.from('menu') takes. */
export function photoObjectKey(itemId: string, n: number, ext: string): string {
  return `${itemId}/${n}.${ext}`;
}

/** What goes into `menu_items.photos`: the same key, bucket-qualified (§1.2). */
export function photoStoredPath(itemId: string, n: number, ext: string): string {
  return `${PHOTO_BUCKET}/${photoObjectKey(itemId, n, ext)}`;
}

/** Strip the bucket prefix back off a stored path. Absolute URLs are left alone (they are not ours). */
export function objectKeyOf(storedPath: string): string | null {
  if (/^https?:\/\//.test(storedPath)) return null;
  return storedPath.startsWith(`${PHOTO_BUCKET}/`) ? storedPath.slice(PHOTO_BUCKET.length + 1) : storedPath;
}

/** Next free `<n>` for an item, so a replace never overwrites a path a browser has already cached. */
export function nextPhotoIndex(photos: Json): number {
  let max = 0;
  for (const p of photoPaths(photos)) {
    const m = /\/(\d+)\.[a-z0-9]+$/i.exec(p);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export type PhotoRejection = { reason: "type" | "size"; detail: string };

/** Client-side gate before anything is read: the two failures §6.8 names, with the reason. */
export function rejectPhoto(file: { type: string; size: number; name: string }): PhotoRejection | null {
  if (!isPhotoMime(file.type)) return { reason: "type", detail: file.type || file.name };
  if (file.size > PHOTO_MAX_BYTES) return { reason: "size", detail: `${(file.size / 1048576).toFixed(1)} MB` };
  return null;
}

/** Move a photo inside the list (drag to reorder; index 0 is the card image). */
export function movePhoto(paths: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= paths.length || to >= paths.length) return paths;
  const next = paths.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as string);
  return next;
}

/* ------------------------------------------------------------------ option groups (§1.2) */

export type GroupRule = "any" | "one" | "range";

export type RuleShape = { min_select: number; max_select: number | null; required: boolean };

/** The three rules the design names: "Beliebig viele", "Genau eine", "0 bis 3". */
export function ruleOf(g: Pick<RuleShape, "min_select" | "max_select">): GroupRule {
  if (g.min_select === 1 && g.max_select === 1) return "one";
  if (g.min_select === 0 && g.max_select == null) return "any";
  return "range";
}

export function ruleShape(rule: GroupRule, current?: RuleShape): RuleShape {
  switch (rule) {
    case "any":
      return { min_select: 0, max_select: null, required: false };
    case "one":
      return { min_select: 1, max_select: 1, required: true };
    default:
      return { min_select: current?.min_select ?? 0, max_select: current?.max_select ?? 3, required: current?.required ?? false };
  }
}

export type GroupError = "name" | "range" | "required_min" | "no_options" | "option_name" | "option_price";

export type ValidatableGroup = RuleShape & {
  name_de: string;
  options: { name_de: string; price_cents: number }[];
};

/** Everything that must hold before a group may be saved. Order is the order they are shown in. */
export function validateGroup(g: ValidatableGroup): GroupError[] {
  const errors: GroupError[] = [];
  if (blank(g.name_de)) errors.push("name");
  if (g.min_select < 0 || (g.max_select != null && g.max_select < Math.max(1, g.min_select))) errors.push("range");
  if (g.required && g.min_select < 1) errors.push("required_min");
  if (g.options.length === 0) errors.push("no_options");
  if (g.options.some((o) => blank(o.name_de))) errors.push("option_name");
  if (g.options.some((o) => !Number.isFinite(o.price_cents) || o.price_cents < 0)) errors.push("option_price");
  return errors;
}

/* ------------------------------------------------------------------ category schedule (§1.2) */

export type Schedule = { days: number[]; until: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `{"days":[1,2,3,4,5],"until":"15:00"}` — anything else is treated as "no schedule". */
export function parseSchedule(value: Json): Schedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const days = Array.isArray(raw.days) ? raw.days.filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7) : [];
  const until = typeof raw.until === "string" && HHMM.test(raw.until) ? raw.until : null;
  if (!days.length || !until) return null;
  return { days: [...new Set(days)].sort((a, b) => a - b), until };
}

export function isValidSchedule(s: Schedule): boolean {
  return s.days.length > 0 && HHMM.test(s.until);
}

/** "Mo–Fr" for a run of consecutive days, "Mo, Mi, Fr" otherwise. */
export function daysLabel(days: number[], names: string[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (!sorted.length) return "";
  const consecutive = sorted.every((d, i) => i === 0 || d === (sorted[i - 1] as number) + 1);
  const name = (d: number) => names[d - 1] ?? String(d);
  if (consecutive && sorted.length > 2) return `${name(sorted[0] as number)}–${name(sorted[sorted.length - 1] as number)}`;
  return sorted.map(name).join(", ");
}

/* ------------------------------------------------------------------ sorting */

/**
 * Drag-to-sort: the new order of ids, each paired with the `sort` value to persist. Values are
 * renumbered from 10 in steps of 10 so a later single insert does not need a full rewrite.
 */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

export function sortValues(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * 10);
}

/* ------------------------------------------------------------------ list filtering */

export type ItemFilter = "all" | "active" | "stoplist" | "incomplete";

export type FilterableItem = CompletenessItem & {
  id: string;
  sku: string;
  name_ja: string | null;
  transliteration: string | null;
  category_id: string;
  available: boolean;
  stoplist_until: string | null;
};

export function matchesItemSearch(item: FilterableItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name_de, item.name_en, item.name_ja, item.transliteration, item.sku].filter(Boolean).join(" ").toLowerCase().includes(q);
}

export function filterItems(
  items: FilterableItem[],
  opts: { filter: ItemFilter; query: string; categoryId: string | null; today: string; categories: Map<string, { active: boolean }> },
): FilterableItem[] {
  return items.filter((item) => {
    if (opts.categoryId && item.category_id !== opts.categoryId) return false;
    if (!matchesItemSearch(item, opts.query)) return false;
    switch (opts.filter) {
      case "active":
        return isOnSale(item, opts.categories.get(item.category_id), opts.today);
      case "stoplist":
        return isStopped(item.stoplist_until, opts.today);
      case "incomplete":
        return completeness(item).length > 0;
      default:
        return true;
    }
  });
}

/* ------------------------------------------------------------------ allergens (§1.2, German scheme) */

export const ALLERGENS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const ITEM_TAGS = ["new", "hit", "spicy", "vegetarian"] as const;
export type ItemTag = (typeof ITEM_TAGS)[number];

/** A stable, collision-resistant SKU suggestion for a new item: category prefix + running number. */
export function suggestSku(categorySlug: string, existing: string[]): string {
  const prefix = (categorySlug.replace(/[^a-z]/gi, "").slice(0, 2) || "IT").toUpperCase();
  let max = 0;
  for (const sku of existing) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(sku);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** "Philadelphia Deluxe" → "philadelphia-deluxe" for a new category slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function uniqueSlug(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 200; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/* ------------------------------------------------------------------ duplicate */

type Identity = { id: string; created_at: string; updated_at: string };

/** A row without the columns the database owns — the body of an insert built from an existing row. */
export function withoutIdentity<T extends Identity>(row: T): Omit<T, keyof Identity> {
  const copy: Partial<T> = { ...row };
  delete copy.id;
  delete copy.created_at;
  delete copy.updated_at;
  return copy as Omit<T, keyof Identity>;
}

type Duplicable = Identity & { sku: string; name_de: string; name_en: string; sort: number };

/**
 * "Duplizieren" in one place: a fresh SKU, "(2)" on both names, hidden until the operator is happy
 * with it, and no photos — the copy must not share objects whose deletion would blank the original.
 */
export function duplicateInsert<T extends Duplicable>(item: T, sku: string): Omit<T, keyof Identity> {
  return {
    ...withoutIdentity(item),
    sku,
    name_de: `${item.name_de} (2)`,
    name_en: item.name_en ? `${item.name_en} (2)` : item.name_en,
    available: false,
    photos: [],
    sort: item.sort + 1,
  };
}
