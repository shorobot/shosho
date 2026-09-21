"use client";
import Link from "next/link";
import { useCatalog, useCart } from "@/lib/cart";
import { euro } from "@/lib/money";
import { badgeFor, defaultOptionIds, groupsFor, optionsLabel, shortDescription } from "@/lib/options";
import { itemSlug } from "@/lib/slug";
import type { MenuItem } from "@/lib/types";
import { Pill } from "./Pill";
import { Photo } from "./Photo";

// Product card (Home grid): photo with badge, kana over the name, descriptor, price, "+ Add".
// "+ Add" adds with the default options; the name/photo open the product page for customising.
export function ProductCard({ item, disabled, index = 0 }: { item: MenuItem; disabled?: boolean; index?: number }) {
  const { itemOptionGroups } = useCatalog();
  const cart = useCart();
  const badge = badgeFor(item);
  const href = `/menu/${itemSlug(item)}`;
  const groups = groupsFor(itemOptionGroups, item.id);

  const add = () => {
    const ids = defaultOptionIds(groups);
    cart.add(item, ids, 1, optionsLabel(groups, ids));
  };

  return (
    <article className="flex flex-col gap-3 rounded-3xl bg-paper p-3.5 shadow-(--shadow-card) transition-micro hover:-translate-y-0.5">
      <Link href={href} className="relative block aspect-[4/3] overflow-hidden rounded-2xl bg-[#F7F3EF]" aria-label={item.name_en}>
        <Photo item={item} index={index} />
        {badge && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-ink px-2.5 py-[5px] text-[10px] font-medium leading-[1.3] tracking-[0.08em] text-cream">{badge}</span>
        )}
      </Link>
      <div className="flex flex-col gap-1">
        <span className="kana text-[12px] leading-[1.3] text-blue">{item.name_ja ?? item.transliteration ?? " "}</span>
        <Link href={href} className="text-[17px] font-extrabold leading-[1.15] tracking-[-0.01em] text-ink hover:text-orange">
          {item.name_en}
        </Link>
        <span className="line-clamp-1 text-[12px] leading-[1.4] text-muted">{shortDescription(item)}</span>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2.5">
        <span className="whitespace-nowrap text-[20px] font-extrabold leading-[1.3]">{euro(item.base_price_cents)}</span>
        <Pill size="sm" onClick={add} disabled={disabled} aria-label={`Add ${item.name_en}`} className="px-[18px] py-[11px]">
          + Add
        </Pill>
      </div>
    </article>
  );
}
