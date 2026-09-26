import type { MenuItem } from "@/lib/types";

// Photos: storage bucket `menu` does not exist yet (api-contracts §5.5) → placeholder art in brand tints
// with a stone shape, no lettering (the kana already sits above the name on the card). When `photos[0]`
// is an absolute URL it is used as-is.
const TINTS = ["photo-sand", "photo-sky", "photo-blush", "photo-stone"];
const STONES = ["bg-sky/45", "bg-blush/50", "bg-sand", "bg-sky/35"];

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
    <div className={`relative h-full w-full overflow-hidden ${TINTS[index % TINTS.length]} ${className}`} aria-hidden>
      <span className={`stone absolute left-[16%] top-[18%] h-[62%] w-[56%] ${STONES[index % STONES.length]}`} />
      <span className="dot-grid absolute bottom-[12%] right-[10%] h-[44px] w-[28px]" />
    </div>
  );
}
