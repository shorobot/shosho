"use client";
import Image from "next/image";
import { PillLink } from "@/components/ui/Pill";
import { useCatalog } from "@/lib/cart";
import type { Banner, BannerSlot as Slot } from "@/lib/types";

// CMS banners (api-contracts §8.6) for the three "strip" slots — home_strip, product, checkout.
// `home_hero` is NOT rendered through this component: Hero.tsx owns that slot itself, because an
// empty home_hero keeps the existing static hero rather than rendering nothing (api-contracts §8.6,
// S3-03: "empty is the normal case ... must look deliberate rather than broken").
//
// `banners` is already filtered to active, in-window rows by the data layer's query
// (lib/api-supabase.ts orders by slot then sort) — this re-sorts by `sort` anyway rather than
// trusting that order to survive filtering down to one slot.
export function BannerSlot({ slot, className = "" }: { slot: Exclude<Slot, "home_hero">; className?: string }) {
  const { banners } = useCatalog();
  const rows = banners.filter((b) => b.slot === slot).sort((a, b) => a.sort - b.sort);
  if (rows.length === 0) return null;
  return (
    <div className={`flex flex-col gap-3 ${className}`} aria-label="Promotions">
      {rows.map((b) => (
        <BannerCard key={b.id} banner={b} />
      ))}
    </div>
  );
}

// English only: the storefront has no language toggle yet (that is a separate, later boot — see
// README "Banners"); title_de/subtitle_de/cta_label_de are still read into Banner so the toggle has
// nothing left to wire up on the data side when it lands.
function BannerCard({ banner }: { banner: Banner }) {
  const title = banner.title_en;
  const subtitle = banner.subtitle_en;
  const cta = banner.cta_label_en;
  return (
    <div className="card relative flex items-center gap-4 overflow-hidden p-4 md:p-5">
      {banner.image_path && (
        <div className="relative h-[64px] w-[64px] flex-none overflow-hidden rounded-[14px] md:h-[84px] md:w-[84px]" aria-hidden>
          <Image src={banner.image_path} alt="" fill sizes="84px" className="object-cover" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <span className="truncate text-[15px] font-extrabold leading-[1.3] text-ink">{title}</span>}
        {subtitle && <span className="text-[13px] leading-[1.4] text-ink-3">{subtitle}</span>}
      </div>
      {cta && banner.cta_href && (
        <PillLink href={banner.cta_href} variant="soft" size="sm" className="flex-none">
          {cta}
        </PillLink>
      )}
    </div>
  );
}
