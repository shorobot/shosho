"use client";

// Photo rendering for the back-office. `menu_items.photos` holds bucket-qualified paths
// ("menu/<item_id>/<n>.jpg", §1.2); the public URL comes from the bucket's CDN. An absolute URL is
// passed through untouched (that is what the seed and the guest site's placeholders use today).
import { useSupabase } from "@/components/providers/EnvProvider";
import { PHOTO_BUCKET, objectKeyOf, photoPaths } from "@/lib/menu";
import type { Client } from "@/lib/supabase/client";
import type { Json } from "@/lib/types";

export function publicPhotoUrl(supabase: Client, storedPath: string): string {
  if (/^https?:\/\//.test(storedPath)) return storedPath;
  const key = objectKeyOf(storedPath);
  if (!key) return storedPath;
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(key).data.publicUrl;
}

export function usePhotoUrl(): (storedPath: string) => string {
  const supabase = useSupabase();
  return (p) => publicPhotoUrl(supabase, p);
}

/** Square thumb for the items table; falls back to the brand stone when there is no photo. */
export function Thumb({ photos, alt, size = 44, className = "" }: { photos: Json; alt: string; size?: number; className?: string }) {
  const url = usePhotoUrl();
  const first = photoPaths(photos)[0];
  return (
    <span className={`relative block flex-none overflow-hidden rounded-[12px] bg-sand ${className}`} style={{ width: size, height: size }}>
      {first ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url(first)} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="absolute left-[18%] top-[20%] h-[60%] w-[64%] rounded-[45%_55%_48%_52%/52%_46%_54%_48%] bg-sky/45" aria-hidden />
      )}
    </span>
  );
}
