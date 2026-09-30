import Image from "next/image";
import type { MenuItem } from "@/lib/types";
import { isAbsolutePhotoUrl } from "@/lib/photos";

// Photos arrive from the data layer already resolved to absolute URLs (lib/photos.ts resolves the
// `menu/<item_id>/<n>.jpg` bucket paths the back-office writes). Items with no photo keep the brand
// placeholder: stone + dot grid in a brand tint, no lettering — the kana already sits above the name.
//
// Every caller wraps this in a box that owns the aspect ratio, so `fill` is right and there is no
// layout shift. `sizes` states the rendered width per breakpoint; it is inert while
// `images.unoptimized` is on (next.config.ts) and becomes live the day an optimizer is affordable.
const TINTS = ["photo-sand", "photo-sky", "photo-blush", "photo-stone"];
const STONES = ["bg-sky/45", "bg-blush/50", "bg-sand", "bg-sky/35"];

/** The first usable photo URL of an item, or null → placeholder. */
export function photoUrl(item: Pick<MenuItem, "photos">): string | null {
  const p = Array.isArray(item.photos) ? item.photos[0] : null;
  return isAbsolutePhotoUrl(p) ? p.trim() : null;
}

export function Photo({
  item,
  index = 0,
  className = "",
  sizes = "(max-width: 768px) 50vw, 320px",
  priority = false,
}: {
  item: Pick<MenuItem, "photos" | "name_en" | "name_ja">;
  index?: number;
  className?: string;
  /** Rendered width of this box, for the srcset the optimizer would pick from. */
  sizes?: string;
  /** Above the fold on first paint (the product page's main photo, the first cards). */
  priority?: boolean;
}) {
  const url = photoUrl(item);
  if (url) {
    return (
      <Image
        src={url}
        alt={item.name_en}
        fill
        sizes={sizes}
        priority={priority}
        // `priority` alone only disables lazy loading and asks React to preload; Next 15 does not
        // derive `fetchpriority` from it, so the above-the-fold photo says so itself.
        fetchPriority={priority ? "high" : undefined}
        loading={priority ? undefined : "lazy"}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <div className={`relative h-full w-full overflow-hidden ${TINTS[index % TINTS.length]} ${className}`} aria-hidden>
      <span className={`stone absolute left-[16%] top-[18%] h-[62%] w-[56%] ${STONES[index % STONES.length]}`} />
      <span className="dot-grid absolute bottom-[12%] right-[10%] h-[44px] w-[28px]" />
    </div>
  );
}
