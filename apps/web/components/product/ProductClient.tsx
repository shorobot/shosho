"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CartPanel } from "@/components/site/CartPanel";
import { StatusBanners, useOrderingState } from "@/components/site/StatusBanners";
import { Pill } from "@/components/ui/Pill";
import { Photo } from "@/components/ui/Photo";
import { QtyStepper } from "@/components/ui/QtyStepper";
import { useCart, useCatalog } from "@/lib/cart";
import { euro, euroShort } from "@/lib/money";
import { badgeFor, defaultOptionIds, groupKind, groupsFor, optionsLabel, optionsValid } from "@/lib/options";
import { itemSlug } from "@/lib/slug";
import type { MenuCategory, MenuItem, OptionGroup } from "@/lib/types";
import { freeDeliveryThreshold } from "@/components/site/FreeDeliveryBar";
import { useLinePrice } from "@/lib/useLinePrice";

// Product page: breadcrumb, kana + name, description, SIZE segmented (required & max 1), other
// groups as radio/checkbox per min/max, qty, "Add to order" with the live price, trust chips,
// "Goes well with". The live price on the button is quote_order's line total for this exact
// configuration (lib/useLinePrice.ts) — nothing is priced in the browser.
export function ProductClient({ item, category, recommended }: { item: MenuItem; category: MenuCategory | null; recommended: MenuItem[] }) {
  const { itemOptionGroups, zones, settings } = useCatalog();
  const cart = useCart();
  const { canOrder } = useOrderingState();
  const groups = useMemo(() => groupsFor(itemOptionGroups, item.id), [itemOptionGroups, item.id]);
  const [selected, setSelected] = useState<string[]>(() => defaultOptionIds(groups));
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const valid = optionsValid(groups, selected);
  const live = useLinePrice(item.id, selected, qty);
  const badge = badgeFor(item);
  const freeOver = freeDeliveryThreshold(cart.quote?.zone, settings.site, zones);

  const toggle = (g: OptionGroup, id: string) => {
    const kind = groupKind(g);
    const inGroup = g.options.map((o) => o.id);
    if (kind !== "checkbox") {
      setSelected((s) => [...s.filter((x) => !inGroup.includes(x)), ...(kind === "radio" && s.includes(id) ? [] : [id])]);
      return;
    }
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      const n = s.filter((x) => inGroup.includes(x)).length;
      if (g.max_select != null && n >= g.max_select) return s;
      return [...s, id];
    });
  };

  const add = () => {
    cart.add(item, selected, qty, optionsLabel(groups, selected));
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  return (
    <div className="screen-in mx-auto flex max-w-[1560px] flex-wrap items-start gap-[22px] px-3 pt-[22px] md:px-[22px]">
      <div className="flex min-w-0 flex-1 basis-[520px] flex-col gap-5">
        <section className="card p-5 md:p-[26px]">
          <nav className="mb-[18px] text-[12px] leading-[1.3] text-muted-2" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-orange">Menu</Link>
            {category && (<> / <Link href={`/?c=${category.slug}#menu`} className="hover:text-orange">{category.name_en}</Link></>)}
            {" / "}
            <span className="font-extrabold text-ink">{item.name_en}</span>
          </nav>
          <div className="grid items-start gap-[34px] md:grid-cols-[repeat(auto-fit,minmax(330px,1fr))]">
            <div className="flex flex-col gap-3">
              <div className="relative aspect-square overflow-hidden rounded-[22px] bg-[#F7F3EF]">
                <Photo item={item} index={0} />
              </div>
              <div className="flex gap-2.5" aria-hidden>
                <div className="aspect-square flex-1 rounded-[14px] border-2 border-orange photo-sand" />
                <div className="aspect-square flex-1 rounded-[14px] photo-stone" />
                <div className="aspect-square flex-1 rounded-[14px] photo-stone" />
                <div className="aspect-square flex-1 rounded-[14px] photo-stone" />
              </div>
            </div>
            <div className="flex flex-col gap-[18px]">
              <div className="flex flex-wrap items-center gap-2.5">
                {badge && <span className="rounded-full bg-ink px-3 py-1.5 text-[10px] font-medium leading-[1.3] tracking-[0.1em] text-cream">{badge}</span>}
                {item.allergens.length > 0 && <span className="text-[12px] font-medium leading-[1.3] text-ink-2">Allergens {item.allergens.join(", ")}</span>}
                {item.weight_g && <span className="text-[12px] font-medium leading-[1.3] text-muted">· {item.weight_g} g</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="kana text-[20px] font-bold leading-[1.3] text-blue">{item.name_ja ?? item.transliteration}</span>
                <h1 className="text-[clamp(28px,3.4vw,46px)] font-extrabold leading-[1.02] tracking-[-0.02em] [overflow-wrap:anywhere]">{item.name_en}</h1>
                {item.description_en && <p className="max-w-[520px] text-[15px] leading-[1.55] text-ink-3">{item.description_en}</p>}
              </div>

              {groups.map((g) => {
                const kind = groupKind(g);
                const rule = kind === "segmented" ? "" : kind === "radio" ? " · pick one" : g.max_select != null ? ` · up to ${g.max_select}` : " · any";
                const sel = g.options.filter((o) => selected.includes(o.id)).length;
                const missing = (g.required || g.min_select > 0) && sel < Math.max(g.min_select, g.required ? 1 : 0);
                return (
                  <fieldset key={g.id} className="flex flex-col gap-2.5">
                    <legend className="label-caps mb-2.5">{g.name_en}{rule}{missing && <span className="ml-2 normal-case tracking-normal text-orange">required</span>}</legend>
                    <div className="flex flex-wrap gap-2.5">
                      {g.options.map((o) => {
                        const on = selected.includes(o.id);
                        const price = o.price_cents === 0 ? "free" : `+${euro(o.price_cents)}`;
                        return (
                          <button
                            key={o.id}
                            type="button"
                            role={kind === "checkbox" ? "checkbox" : "radio"}
                            aria-checked={on}
                            onClick={() => toggle(g, o.id)}
                            className={`flex items-center gap-2 rounded-full leading-[1.3] transition-micro ${
                              on ? "border-2 border-orange bg-orange-tint px-[21px] py-[11px] text-[13px] font-extrabold text-ink" : "border border-line-2 bg-paper px-[22px] py-3 text-[13px] font-medium text-ink-2 hover:border-muted"
                            }`}
                          >
                            <span>{o.name_en}</span>
                            {kind !== "segmented" && <span className={`text-[11px] font-medium ${on ? "text-orange" : "text-orange/80"}`}>{price}</span>}
                            {kind === "segmented" && o.price_cents > 0 && <span className="text-[11px] font-medium text-muted">+{euro(o.price_cents)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}

              <StatusBanners compact />
              <div className="mt-1.5 flex items-center gap-3.5">
                <QtyStepper value={qty} min={1} max={item.max_per_order} onChange={setQty} />
                <Pill size="lg" onClick={add} disabled={!valid || !canOrder} className="flex-1 justify-between px-[30px] py-[19px] text-[16px]" aria-live="polite">
                  <span>{added ? "Added ✓" : "Add to order"}</span>
                  <span className={live.loading ? "opacity-60" : ""}>{live.cents != null ? euro(live.cents) : euro(item.base_price_cents)}</span>
                </Pill>
              </div>
              <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 pt-1 text-[12px] leading-[1.3] text-muted">
                {item.prep_minutes != null && <span>⚡ Ready in {item.prep_minutes} min</span>}
                {freeOver != null && <span>◉ Free delivery over {euroShort(freeOver)}</span>}
                <span>❄ Kept at 4 °C</span>
              </div>
            </div>
          </div>
        </section>

        {recommended.length > 0 && (
          <section className="card p-5 md:p-6">
            <div className="mb-4 flex items-baseline gap-3">
              <h3 className="text-[20px] font-extrabold leading-[1.3]">Goes well with</h3>
              <span className="kana text-[13px] leading-[1.3] text-blue">おすすめ</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
              {recommended.map((r, i) => (
                <Pairing key={r.id} item={r} index={i} disabled={!canOrder} />
              ))}
            </div>
          </section>
        )}
      </div>
      <CartPanel />
    </div>
  );
}

function Pairing({ item, index, disabled }: { item: MenuItem; index: number; disabled: boolean }) {
  const { itemOptionGroups } = useCatalog();
  const cart = useCart();
  const groups = groupsFor(itemOptionGroups, item.id);
  const add = () => {
    const ids = defaultOptionIds(groups);
    cart.add(item, ids, 1, optionsLabel(groups, ids));
  };
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-[#EFEAE4] p-3">
      <Link href={`/menu/${itemSlug(item)}`} className="h-14 w-14 flex-none overflow-hidden rounded-[14px]" aria-label={item.name_en}>
        <Photo item={item} index={index + 1} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <Link href={`/menu/${itemSlug(item)}`} className="text-[13px] font-extrabold leading-[1.2] hover:text-orange">{item.name_en}</Link>
        <span className="line-clamp-1 text-[11px] leading-[1.3] text-muted">{item.description_en}</span>
        <span className="whitespace-nowrap text-[13px] font-extrabold leading-[1.3] text-orange">{euro(item.base_price_cents)}</span>
      </div>
      <button type="button" onClick={add} disabled={disabled} aria-label={`Add ${item.name_en}`} className="h-[30px] w-[30px] flex-none rounded-full bg-orange text-center text-[16px] font-extrabold leading-[30px] text-white transition-micro hover:brightness-105 disabled:opacity-40">
        +
      </button>
    </div>
  );
}
