import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { PHOTO_BUCKET, isAbsolutePhotoUrl, photoObjectKey, resolvePhotos, storagePublicUrl } from "@/lib/photos";

const SUPABASE_URL = "https://bvmitglwwqsvufetlkff.supabase.co";
const publicUrl = (key: string) => storagePublicUrl(SUPABASE_URL, key);

describe("photoObjectKey", () => {
  it("strips the bucket prefix the back-office writes", () => {
    expect(photoObjectKey("menu/30000000-0000-4000-8000-000000000001/1.jpg")).toBe("30000000-0000-4000-8000-000000000001/1.jpg");
    expect(photoObjectKey("menu/abc/2.webp")).toBe("abc/2.webp");
  });

  it("accepts a path that is already bucket-relative", () => {
    expect(photoObjectKey("abc/1.jpg")).toBe("abc/1.jpg");
    expect(photoObjectKey("/menu/abc/1.jpg")).toBe("abc/1.jpg");
  });

  it("refuses absolute URLs — those are the other branch", () => {
    expect(photoObjectKey("https://cdn.example.com/a.jpg")).toBeNull();
    expect(photoObjectKey("http://cdn.example.com/a.jpg")).toBeNull();
  });

  it("refuses everything malformed rather than pointing somewhere else", () => {
    expect(photoObjectKey("")).toBeNull();
    expect(photoObjectKey("   ")).toBeNull();
    expect(photoObjectKey("menu/")).toBeNull();
    expect(photoObjectKey(null)).toBeNull();
    expect(photoObjectKey(undefined)).toBeNull();
    expect(photoObjectKey(42)).toBeNull();
    expect(photoObjectKey({ path: "menu/a/1.jpg" })).toBeNull();
    expect(photoObjectKey("//evil.example.com/a.jpg")).toBeNull();
    expect(photoObjectKey("data:image/png;base64,AAAA")).toBeNull();
    expect(photoObjectKey("javascript:alert(1)")).toBeNull();
    expect(photoObjectKey("menu/../../etc/passwd")).toBeNull();
    expect(photoObjectKey("a//b.jpg")).toBeNull();
  });
});

describe("isAbsolutePhotoUrl", () => {
  it("is true only for a real http(s) URL", () => {
    expect(isAbsolutePhotoUrl("https://x.test/a.jpg")).toBe(true);
    expect(isAbsolutePhotoUrl("  http://x.test/a.jpg  ")).toBe(true);
    expect(isAbsolutePhotoUrl("https://")).toBe(false);
    expect(isAbsolutePhotoUrl("menu/a/1.jpg")).toBe(false);
    expect(isAbsolutePhotoUrl(null)).toBe(false);
  });
});

describe("resolvePhotos", () => {
  it("resolves the bucket paths that made every card fall back to the placeholder", () => {
    expect(resolvePhotos(["menu/item-1/1.jpg"], publicUrl)).toEqual([
      `${SUPABASE_URL}/storage/v1/object/public/menu/item-1/1.jpg`,
    ]);
  });

  it("keeps absolute URLs as they are, so the seed data still works", () => {
    expect(resolvePhotos(["https://cdn.example.com/a.jpg"], publicUrl)).toEqual(["https://cdn.example.com/a.jpg"]);
  });

  it("keeps order and drops only what it cannot resolve", () => {
    expect(resolvePhotos(["menu/i/1.jpg", "", "https://cdn.test/b.jpg", null, "menu/../x"], publicUrl)).toEqual([
      `${SUPABASE_URL}/storage/v1/object/public/menu/i/1.jpg`,
      "https://cdn.test/b.jpg",
    ]);
  });

  it("yields nothing for empty or non-array input — the item keeps the brand placeholder", () => {
    expect(resolvePhotos([], publicUrl)).toEqual([]);
    expect(resolvePhotos(null, publicUrl)).toEqual([]);
    expect(resolvePhotos("menu/i/1.jpg", publicUrl)).toEqual([]);
    expect(resolvePhotos([""], publicUrl)).toEqual([]);
  });

  it("yields nothing when the server has no Supabase URL, instead of a broken src", () => {
    expect(resolvePhotos(["menu/i/1.jpg"], (k) => storagePublicUrl("", k))).toEqual([]);
  });

  it("percent-encodes a key with spaces", () => {
    expect(resolvePhotos(["menu/i/my photo.jpg"], publicUrl)).toEqual([
      `${SUPABASE_URL}/storage/v1/object/public/menu/i/my%20photo.jpg`,
    ]);
  });
});

describe("storagePublicUrl", () => {
  // The data layer builds the URL with the SDK; this asserts our own builder has not drifted from it,
  // because the tests (and the mock layer) use ours.
  it("matches supabase.storage.from(bucket).getPublicUrl()", () => {
    const sb = createClient(SUPABASE_URL, "anon-key-not-used-offline");
    for (const key of ["item-1/1.jpg", "a/b/2.webp"]) {
      expect(storagePublicUrl(SUPABASE_URL, key)).toBe(sb.storage.from(PHOTO_BUCKET).getPublicUrl(key).data.publicUrl);
    }
  });

  it("tolerates a trailing slash on the project URL", () => {
    expect(storagePublicUrl(`${SUPABASE_URL}/`, "a/1.jpg")).toBe(storagePublicUrl(SUPABASE_URL, "a/1.jpg"));
  });
});
