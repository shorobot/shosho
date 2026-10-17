// Menu photos (api-contracts §1.2, §6.8). `menu_items.photos` holds **bucket-qualified paths** —
// `menu/<item_id>/<n>.jpg`, written by the back-office uploader (S4-02). Seed rows may instead hold
// an absolute URL. Both are resolved to a browser-loadable URL here, and the resolution happens once
// in the data layer (lib/api-supabase.ts) so every surface — card, product page, cart line — renders
// from the same already-absolute strings. Items with no usable photo keep the brand placeholder.

/** Public storage bucket the back-office uploads into. */
export const PHOTO_BUCKET = "menu";

/** Public storage bucket banners upload into (api-contracts §8.6) — same policy shape as `menu`. */
export const SITE_BUCKET = "site";

/** True for a stored value that is already a URL the browser can load. */
export function isAbsolutePhotoUrl(p: unknown): p is string {
  return typeof p === "string" && /^https?:\/\/\S/i.test(p.trim());
}

/**
 * The object key inside `bucket`, or null when `p` is not a usable bucket path. Rejects absolute
 * URLs (handled by `isAbsolutePhotoUrl`), other schemes (`data:`, `javascript:`), protocol-relative
 * paths and traversal — a malformed row must fall back to the placeholder, never produce a URL
 * pointing somewhere else.
 */
function objectKeyInBucket(p: unknown, bucket: string): string | null {
  if (typeof p !== "string") return null;
  const raw = p.trim();
  if (!raw || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const key = raw.replace(/^\/+/, "").replace(new RegExp(`^${bucket}/`), "");
  if (!key) return null;
  if (key.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return key;
}

/** The object key inside the `menu` bucket — see `objectKeyInBucket`. */
export function photoObjectKey(p: unknown): string | null {
  return objectKeyInBucket(p, PHOTO_BUCKET);
}

/** The object key inside the `site` bucket (banner `image_path`) — see `objectKeyInBucket`. */
export function siteObjectKey(p: unknown): string | null {
  return objectKeyInBucket(p, SITE_BUCKET);
}

/**
 * Resolve one banner `image_path` to an absolute URL, or null — a banner may have no image at all,
 * which is normal (api-contracts §8.6 does not require one). Same shape as `resolvePhotos`, for one
 * value instead of an array. `publicUrl` is `(key) => sb.storage.from('site').getPublicUrl(key)...`.
 */
export function resolveBannerImage(image_path: unknown, publicUrl: (key: string) => string | null): string | null {
  if (isAbsolutePhotoUrl(image_path)) return image_path.trim();
  const key = siteObjectKey(image_path);
  return key ? publicUrl(key) : null;
}

/**
 * Same URL `supabase.storage.from('menu').getPublicUrl(key)` builds, without needing a client.
 * The data layer uses the SDK (so the shape follows the SDK); this exists for the mock layer and for
 * the test that asserts the two still agree.
 */
export function storagePublicUrl(supabaseUrl: string | null | undefined, key: string): string | null {
  const base = (supabaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Resolve a stored `photos` array to absolute URLs, dropping anything unusable.
 * `publicUrl` turns a bucket object key into a URL — in the app,
 * `(key) => sb.storage.from('menu').getPublicUrl(key).data.publicUrl`.
 */
export function resolvePhotos(photos: unknown, publicUrl: (key: string) => string | null): string[] {
  if (!Array.isArray(photos)) return [];
  const out: string[] = [];
  for (const p of photos) {
    if (isAbsolutePhotoUrl(p)) {
      out.push(p.trim());
      continue;
    }
    const key = photoObjectKey(p);
    const url = key ? publicUrl(key) : null;
    if (url) out.push(url);
  }
  return out;
}
