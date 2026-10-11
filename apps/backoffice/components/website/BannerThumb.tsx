"use client";

// `banners.image_path` holds a bucket-qualified path ("site/<banner_id>/<n>.jpg", §8.6), the same
// convention `menu_items.photos` uses. The public URL comes from the bucket's CDN; an absolute URL
// is passed through untouched.
import { useSupabase } from "@/components/providers/EnvProvider";
import { SITE_BUCKET, siteObjectKeyOf } from "@/lib/site";
import type { Client } from "@/lib/supabase/client";

export function publicSiteUrl(supabase: Client, storedPath: string): string {
  if (/^https?:\/\//.test(storedPath)) return storedPath;
  const key = siteObjectKeyOf(storedPath);
  if (!key) return storedPath;
  return supabase.storage.from(SITE_BUCKET).getPublicUrl(key).data.publicUrl;
}

export function useSiteUrl(): (storedPath: string) => string {
  const supabase = useSupabase();
  return (p) => publicSiteUrl(supabase, p);
}

/** 16:9-ish thumb; falls back to the brand stone when a banner has no image yet. */
export function BannerThumb({ path, size = 46, className = "" }: { path: string | null; size?: number; className?: string }) {
  const url = useSiteUrl();
  return (
    <span className={`relative block flex-none overflow-hidden rounded-[10px] bg-sand ${className}`} style={{ width: Math.round(size * 1.6), height: size }}>
      {path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url(path)} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="absolute left-[18%] top-[20%] h-[60%] w-[64%] rounded-[45%_55%_48%_52%/52%_46%_54%_48%] bg-sky/45" aria-hidden />
      )}
    </span>
  );
}
