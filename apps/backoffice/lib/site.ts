// Pure logic for BO · Website, the CMS screen (api-contracts §8.6 / §8.7). No React, no Supabase,
// so the vitest suite can cover the parts an operator's trust rests on: what counts as an
// unpublished change, which banner the storefront is showing right now, and exactly what a draft
// patch may contain.
//
// THE MODEL, because getting it wrong is invisible until the storefront shows something nobody
// approved (§8.7):
//   · `settings.draft` is a FULL REPLACEMENT for `value`. Publishing copies draft → value.
//   · `banners.draft`  is a PARTIAL PATCH over the row's live columns. Publishing merges it with
//     `coalesce(draft->>'col', col)` per column — see migration 32.
//   · the guest site reads `settings.value` and the `banners_live` view, never a draft.
//   · `anon` cannot read `settings.draft` at all: its blanket table grant was revoked and
//     re-granted for exactly SETTINGS_ANON_COLUMNS below. RLS is row-level; the column grant is
//     what hides a pending edit inside a row anon is already allowed to read.
import type { Json, Tables } from "@/lib/types";

export type BannerRow = Tables["banners"]["Row"];
export type SettingsRow = Tables["settings"]["Row"];
export type ZoneRow = Tables["delivery_zones"]["Row"];
export type PublicationRow = Tables["site_publications"]["Row"];

/* ------------------------------------------------------------------ the anon surface (§8.7) */

/**
 * The exact column list `anon` holds SELECT on for `public.settings` (migration 32). `draft` is
 * absent, and that absence is the whole protection — a view, an RPC or a `select *` that put it
 * back on an anon-reachable surface would re-open the leak RLS cannot close. Asserted in
 * tests/site.test.ts so the list cannot drift silently, and proved against the live project by
 * tests/anonDraft.live.test.ts.
 */
export const SETTINGS_ANON_COLUMNS = ["key", "value", "created_at", "updated_at"] as const;

/** The explicit column list of `banners_live`, the only anon-reachable banner surface (§8.6). */
export const BANNERS_LIVE_COLUMNS = [
  "id", "slot", "image_path", "title_de", "title_en", "subtitle_de", "subtitle_en",
  "cta_label_de", "cta_label_en", "cta_href", "sort",
] as const;

/** True when a column list would hand a pending draft to a surface `anon` can read. */
export function leaksDraft(columns: readonly string[]): boolean {
  return columns.some((c) => c === "draft" || c === "*");
}

/* ------------------------------------------------------------------ settings keys */

export const SITE_SETTING_KEYS = ["business", "opening_hours", "site"] as const;
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number];

export type BusinessValue = {
  name?: string;
  address?: { street?: string; postal_code?: string; city?: string; country?: string };
  phone?: string;
  email?: string;
  impressum?: string;
  ust_id?: string;
};

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** `[["11:00","23:00"]]` per day — an empty array means closed. `holidays` is a free list of dates. */
export type HoursValue = Partial<Record<Weekday, [string, string][]>> & { holidays?: string[] };

export type SiteValue = {
  seo?: { title?: string; description?: string };
  cookie_banner?: boolean;
  robots?: string;
  maintenance?: boolean;
  free_delivery_hint_cents?: number;
};

/** The value the editor works on: the pending draft if there is one, else what is live. */
export function effectiveValue(row: Pick<SettingsRow, "value" | "draft"> | undefined): Json {
  if (!row) return {};
  return row.draft ?? row.value;
}

/** `true` while this key has an edit that has not reached the storefront. */
export function hasPendingDraft(row: Pick<SettingsRow, "draft"> | undefined): boolean {
  return Boolean(row && row.draft !== null && row.draft !== undefined);
}

/**
 * Stable deep equality over JSON — object key order must not make an unchanged value look pending.
 * Used to decide whether a save stages a draft at all, so the counter never shows a no-op edit.
 */
export function jsonEqual(a: Json | undefined, b: Json | undefined): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: Json | undefined): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x as Json)).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, Json>)[k] as Json)}`).join(",")}}`;
}

/**
 * What to write to `settings.draft` for a save: the full candidate value, or `null` when the edit
 * leaves the live value untouched (staging an identical draft would inflate the counter and make a
 * publish record a change that is not one).
 */
export function settingsDraftFor(live: Json, edited: Json): Json | null {
  return jsonEqual(live, edited) ? null : edited;
}

/* ------------------------------------------------------------------ banners (§8.6) */

export const BANNER_SLOTS = ["home_hero", "home_strip", "product", "checkout"] as const;
export type BannerSlot = (typeof BANNER_SLOTS)[number];

export const SITE_BUCKET = "site";

/** Object key inside the bucket; mirrors the `menu` bucket's `<row_id>/<n>.<ext>` shape (§6.8). */
export function bannerObjectKey(bannerId: string, n: number, ext: string): string {
  return `${bannerId}/${n}.${ext}`;
}

/** What goes into `banners.image_path`: the same key, bucket-qualified. */
export function bannerStoredPath(bannerId: string, n: number, ext: string): string {
  return `${SITE_BUCKET}/${bannerObjectKey(bannerId, n, ext)}`;
}

/** Strip the bucket prefix back off. Absolute URLs are left alone (they are not ours). */
export function siteObjectKeyOf(storedPath: string | null | undefined): string | null {
  if (!storedPath) return null;
  if (/^https?:\/\//.test(storedPath)) return null;
  return storedPath.startsWith(`${SITE_BUCKET}/`) ? storedPath.slice(SITE_BUCKET.length + 1) : storedPath;
}

/** Next free `<n>`, so replacing an image never reuses a path a browser has cached. */
export function nextImageIndex(imagePath: string | null | undefined): number {
  const m = /\/(\d+)\.[a-z0-9]+$/i.exec(imagePath ?? "");
  return m ? Number(m[1]) + 1 : 1;
}

/** The editable fields of a banner — the set `banners.draft` may carry as a patch. */
export const BANNER_FIELDS = [
  "slot", "image_path", "title_de", "title_en", "subtitle_de", "subtitle_en",
  "cta_label_de", "cta_label_en", "cta_href", "valid_from", "valid_to", "sort", "active",
] as const;
export type BannerField = (typeof BANNER_FIELDS)[number];

/** A banner as the editor and the preview see it: live columns with the pending patch applied. */
export type BannerDraftShape = {
  slot: BannerSlot;
  image_path: string | null;
  title_de: string | null;
  title_en: string | null;
  subtitle_de: string | null;
  subtitle_en: string | null;
  cta_label_de: string | null;
  cta_label_en: string | null;
  cta_href: string | null;
  valid_from: string | null;
  valid_to: string | null;
  sort: number;
  active: boolean;
};

function draftObject(draft: Json | null | undefined): Record<string, Json> {
  return draft && typeof draft === "object" && !Array.isArray(draft) ? (draft as Record<string, Json>) : {};
}

/**
 * The merge `publish_site()` will perform, computed client-side so the editor and the preview show
 * what publishing would actually produce. Deliberately mirrors the SQL's `coalesce(draft->>'col',
 * col)`: a key that is absent **or JSON null** keeps the live value (§8.6).
 */
export function mergeBannerDraft(row: BannerRow): BannerDraftShape {
  const d = draftObject(row.draft);
  const str = (k: BannerField, live: string | null): string | null => {
    const v = d[k];
    return typeof v === "string" ? v : live;
  };
  const rawSort = d.sort;
  const rawActive = d.active;
  const rawSlot = d.slot;
  return {
    slot: typeof rawSlot === "string" && (BANNER_SLOTS as readonly string[]).includes(rawSlot) ? (rawSlot as BannerSlot) : row.slot,
    image_path: str("image_path", row.image_path),
    title_de: str("title_de", row.title_de),
    title_en: str("title_en", row.title_en),
    subtitle_de: str("subtitle_de", row.subtitle_de),
    subtitle_en: str("subtitle_en", row.subtitle_en),
    cta_label_de: str("cta_label_de", row.cta_label_de),
    cta_label_en: str("cta_label_en", row.cta_label_en),
    cta_href: str("cta_href", row.cta_href),
    valid_from: str("valid_from", row.valid_from),
    valid_to: str("valid_to", row.valid_to),
    sort: typeof rawSort === "number" ? rawSort : row.sort,
    active: typeof rawActive === "boolean" ? rawActive : row.active,
  };
}

/** The banner as it is live on the storefront right now — the draft deliberately ignored. */
export function liveBanner(row: BannerRow): BannerDraftShape {
  return {
    slot: row.slot as BannerSlot,
    image_path: row.image_path,
    title_de: row.title_de,
    title_en: row.title_en,
    subtitle_de: row.subtitle_de,
    subtitle_en: row.subtitle_en,
    cta_label_de: row.cta_label_de,
    cta_label_en: row.cta_label_en,
    cta_href: row.cta_href,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    sort: row.sort,
    active: row.active,
  };
}

/**
 * Fields a draft cannot express a CLEAR for, and why this matters rather than being pedantry:
 * `publish_site()` casts them — `(draft->>'valid_to')::timestamptz`. A JSON null or an absent key
 * means "keep the live value", so there is no way to spell "set this back to NULL"; and staging an
 * empty string instead would make the cast raise at publish time, failing the WHOLE publish
 * including every unrelated pending change. So the editor refuses to stage these clears and offers
 * an explicit immediate write instead. Reported to S0 as a §8.7 contract gap.
 */
export const UNSTAGEABLE_CLEARS = ["valid_from", "valid_to"] as const;
export type UnstageableClear = (typeof UNSTAGEABLE_CLEARS)[number];

export type BannerPatch = {
  /** What to write into `banners.draft` — `null` when the edit changes nothing stageable. */
  patch: Json | null;
  /** Date fields the operator emptied that a draft cannot carry (see UNSTAGEABLE_CLEARS). */
  clears: UnstageableClear[];
};

const normaliseText = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * The minimal patch for an edit: only the fields whose value differs from the row's LIVE column
 * (not from the current draft — a draft is replaced wholesale, so a field edited back to its live
 * value must drop out of the patch or it would be "pending" forever).
 *
 * Text fields cleared to empty are staged as `""`, which publishes as an empty string; the
 * storefront treats that as absent. Date clears come back in `clears` instead.
 */
export function bannerDraftPatch(row: BannerRow, edited: BannerDraftShape): BannerPatch {
  const patch: Record<string, Json> = {};
  const clears: UnstageableClear[] = [];

  const text = (k: Exclude<BannerField, "slot" | "sort" | "active" | "valid_from" | "valid_to">) => {
    const live = normaliseText(row[k]);
    const next = normaliseText(edited[k]);
    if (live === next) return;
    // Cleared → stage "" (publishes to an empty string, which reads as absent). Set → stage it.
    patch[k] = next ?? "";
  };
  text("image_path");
  text("title_de");
  text("title_en");
  text("subtitle_de");
  text("subtitle_en");
  text("cta_label_de");
  text("cta_label_en");
  text("cta_href");

  for (const k of UNSTAGEABLE_CLEARS) {
    const live = normaliseText(row[k]);
    const next = normaliseText(edited[k]);
    if (live === next) continue;
    if (next === null) clears.push(k);
    else patch[k] = next;
  }

  if (edited.slot !== row.slot) patch.slot = edited.slot;
  if (edited.sort !== row.sort) patch.sort = edited.sort;
  if (edited.active !== row.active) patch.active = edited.active;

  return { patch: Object.keys(patch).length === 0 ? null : patch, clears };
}

/* ------------------------------------------------------------------ banner windows */

export type BannerState = "live" | "scheduled" | "expired" | "inactive";

/**
 * Why a banner is or is not on the storefront. `banners_live` is `active and in-window`, so these
 * four states are the complete answer to "why isn't my banner showing" — computed from the LIVE
 * columns, because that is what the view reads.
 */
export function bannerState(b: Pick<BannerDraftShape, "active" | "valid_from" | "valid_to">, now: Date): BannerState {
  if (!b.active) return "inactive";
  const t = now.getTime();
  if (b.valid_from && new Date(b.valid_from).getTime() > t) return "scheduled";
  if (b.valid_to && new Date(b.valid_to).getTime() < t) return "expired";
  return "live";
}

/** The rows `banners_live` would return, in the view's own order (slot, sort). */
export function liveBanners(rows: BannerRow[], now: Date): BannerRow[] {
  return rows
    .filter((r) => bannerState(liveBanner(r), now) === "live")
    .sort((a, b) => (a.slot === b.slot ? a.sort - b.sort : BANNER_SLOTS.indexOf(a.slot as BannerSlot) - BANNER_SLOTS.indexOf(b.slot as BannerSlot)));
}

/** Next free `sort` within a slot, so a new banner lands last instead of fighting an existing one. */
export function nextSortInSlot(rows: BannerRow[], slot: BannerSlot): number {
  const used = rows.filter((r) => r.slot === slot).map((r) => mergeBannerDraft(r).sort);
  return used.length ? Math.max(...used) + 1 : 0;
}

/* ------------------------------------------------------------------ the pending counter (§8.7) */

export type PendingChange =
  | { kind: "setting"; key: string }
  | { kind: "banner"; id: string; name: string | null };

/**
 * Exactly what `publish_site()` would touch: rows with a non-null `draft`. The counter is this
 * list's length, which is why it cannot drift from what publishing does — both read the same
 * predicate.
 */
export function pendingChanges(settings: SettingsRow[], banners: BannerRow[]): PendingChange[] {
  const out: PendingChange[] = [];
  for (const s of settings) if (hasPendingDraft(s)) out.push({ kind: "setting", key: s.key });
  for (const b of banners) if (hasPendingDraft(b)) out.push({ kind: "banner", id: b.id, name: mergeBannerDraft(b).title_de ?? b.title_de });
  return out;
}

/* ------------------------------------------------------------------ publication history */

export type PublicationSummary = { settingsKeys: string[]; bannerIds: string[] };

export function publicationSummary(row: Pick<PublicationRow, "summary">): PublicationSummary {
  const s = draftObject(row.summary);
  const list = (v: Json | undefined): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return { settingsKeys: list(s.settings_keys), bannerIds: list(s.banner_ids) };
}

/** How many individual rows one publish moved — the history row's headline number. */
export function publicationSize(row: Pick<PublicationRow, "summary">): number {
  const { settingsKeys, bannerIds } = publicationSummary(row);
  return settingsKeys.length + bannerIds.length;
}

/**
 * `publish_site()`'s own return value — `{id, settings_keys, banner_ids}` at the top level, not
 * wrapped in `summary` the way the `site_publications` row is (§8.7). Two shapes for the same
 * information, so they get two readers rather than one cast.
 */
export type PublishResult = { id: string | null; settingsKeys: string[]; bannerIds: string[] };

export function publishResult(value: Json): PublishResult {
  const v = draftObject(value);
  const list = (x: Json | undefined): string[] => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : []);
  return { id: typeof v.id === "string" ? v.id : null, settingsKeys: list(v.settings_keys), bannerIds: list(v.banner_ids) };
}

export function publishResultSize(value: Json): number {
  const r = publishResult(value);
  return r.settingsKeys.length + r.bannerIds.length;
}

/* ------------------------------------------------------------------ delivery zones */

/**
 * Zones live in their own table with no `draft` column (§1.1) — they are NOT part of the staged
 * publish, and the screen says so where they are edited. Writes are owner/operator (`zones_staff_write`),
 * unlike `settings`, which is owner-only.
 */
export const ZONES_ARE_STAGED = false;

/** `"10119, 10435, 10437"` → the `text[]` the column takes; order and duplicates cleaned up. */
export function parsePostalCodes(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const p = part.trim();
    if (p) seen.add(p);
  }
  return [...seen];
}

export function formatPostalCodes(codes: string[] | null | undefined): string {
  return (codes ?? []).join(", ");
}

/* ------------------------------------------------------------------ opening hours */

/** `"11:00"` → minutes since midnight, or null when it is not a time. */
export function parseHm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  // 24:00 is how the seed spells "closes at midnight" — accepted rather than rejected as invalid.
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export type HoursProblem = { day: Weekday; reason: "format" | "order" };

/** The two mistakes a typed time range can carry, so the form can refuse to stage nonsense. */
export function validateHours(value: HoursValue): HoursProblem[] {
  const problems: HoursProblem[] = [];
  for (const day of WEEKDAYS) {
    for (const range of value[day] ?? []) {
      const from = parseHm(range[0] ?? "");
      const to = parseHm(range[1] ?? "");
      if (from === null || to === null) problems.push({ day, reason: "format" });
      else if (to <= from) problems.push({ day, reason: "order" });
    }
  }
  return problems;
}

/** "11:00 — 23:00" / closed, for the read-only row. */
export function hoursLabel(ranges: [string, string][] | undefined, closedWord: string): string {
  if (!ranges || ranges.length === 0) return closedWord;
  return ranges.map(([a, b]) => `${a} — ${b}`).join(", ");
}
