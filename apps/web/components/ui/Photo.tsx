import type { MenuItem } from "@/lib/types";

// Photos: storage bucket `menu` does not exist yet (api-contracts §5.5) → placeholder art in brand tints,
// with the kana as a quiet stamp. When `photos[0]` is an absolute URL it is used as-is.
const TINTS = ["photo-sand", "photo-sky", "photo-blush", "photo-stone"];

export function photoUrl(item: Pick<MenuItem, "photos">): string | null {
  const p = Array.isArray(item.photos) ? item.photos[0] : null;
  return typeof p === "string" && /^https?:\/\//.test(p) ? p : null;
}

export function Photo({ item, index = 0, className = "" }: { item: Pick<MenuItem, "photos" | "name_en" | "name_ja">; index?: number; className?: string }) {
  const url = photoUrl(item);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={item.name_en} className={`h-full w-full object-cover ${className}`} loading="lazy" />;
  }
  return (
    <div className={`flex h-full w-full items-center justify-center overflow-hidden ${TINTS[index % TINTS.length]} ${className}`} aria-hidden>
      <span className="kana max-w-full truncate px-2 text-[18px] font-bold text-ink/20">{item.name_ja ?? ""}</span>
    </div>
  );
}
