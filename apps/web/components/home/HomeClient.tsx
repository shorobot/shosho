"use client";
import { useEffect, useMemo, useState } from "react";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, PillLink } from "@/components/ui/Pill";
import { ProductCard } from "@/components/ui/ProductCard";
import { CartPanel } from "@/components/site/CartPanel";
import { StatusBanners, useOrderingState } from "@/components/site/StatusBanners";
import { useUi } from "@/components/site/UiProvider";
import { useCatalog } from "@/lib/cart";
import type { MenuCategory, MenuItem } from "@/lib/types";
import { Hero } from "./Hero";

type Cat = MenuCategory & { count: number };
type Sort = "popular" | "price-asc" | "price-desc";
const TAGS: { id: string; label: string }[] = [
  { id: "hit", label: "Bestseller" },
  { id: "new", label: "New" },
  { id: "spicy", label: "Spicy" },
  { id: "vegetarian", label: "Vegetarian" },
];

function matches(item: MenuItem, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [item.name_en, item.name_de, item.name_ja, item.transliteration, item.description_en, item.description_de]
    .filter(Boolean)
    .some((t) => t!.toLowerCase().includes(s));
}

export function HomeClient({ categories, initialQuery, initialCategory }: { categories: Cat[]; initialQuery: string; initialCategory: string }) {
  const { items, online } = useCatalog();
  const { query, setQuery } = useUi();
  const { canOrder } = useOrderingState();
  const [category, setCategory] = useState<string>(initialCategory);
  const [sort, setSort] = useState<Sort>("popular");
  const [tags, setTags] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery, setQuery]);

  const activeCat = categories.find((c) => c.slug === category);
  const list = useMemo(() => {
    let out = items.filter((it) => matches(it, query));
    if (activeCat) out = out.filter((it) => it.category_id === activeCat.id);
    if (tags.length) out = out.filter((it) => tags.every((t) => it.tags.includes(t)));
    const pop = (it: MenuItem) => (it.tags.includes("hit") ? 0 : it.tags.includes("new") ? 1 : 2);
    out = [...out].sort((a, b) =>
      sort === "price-asc" ? a.base_price_cents - b.base_price_cents : sort === "price-desc" ? b.base_price_cents - a.base_price_cents : pop(a) - pop(b) || a.sort - b.sort || a.name_en.localeCompare(b.name_en),
    );
    return out;
  }, [items, query, activeCat, tags, sort]);

  const setsCat = categories.find((c) => c.slug === "sets");
  const fromCents = setsCat ? Math.min(...items.filter((i) => i.category_id === setsCat.id).map((i) => i.base_price_cents)) : null;
  const searching = query.trim().length > 0;
  const title = searching ? `Results for “${query.trim()}”` : activeCat ? activeCat.name_en : "Popular right now";
  const kana = searching ? "検索" : activeCat ? activeCat.name_ja : "人気";
  const sortLabel = sort === "popular" ? "popular" : sort === "price-asc" ? "price ↑" : "price ↓";

  return (
    <div className="mx-auto max-w-[1560px] px-3 pt-[22px] md:px-[22px]">
      <div className="flex flex-wrap items-start gap-[22px]">
        <div className="flex min-w-0 flex-1 basis-[520px] flex-col gap-5">
          <Hero fromCents={Number.isFinite(fromCents) ? fromCents : null} />
          <StatusBanners />

          {/* category rail */}
          <div id="sets" className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1.5 pt-0.5" role="tablist" aria-label="Categories">
            {categories.map((c, i) => (
              <CategoryChip
                key={c.id}
                slug={c.slug}
                kana={c.name_ja}
                label={c.name_en}
                index={i}
                count={c.count}
                active={category === c.slug}
                onClick={() => {
                  setCategory(category === c.slug ? "" : c.slug);
                  document.getElementById("menu")?.scrollIntoView({ block: "start" });
                }}
              />
            ))}
          </div>

          {/* heading + sort/filter */}
          <div id="menu" className="flex scroll-mt-[96px] flex-wrap items-baseline justify-between gap-x-3.5 gap-y-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-[26px] font-extrabold leading-[1.2] tracking-[-0.01em]">{title}</h2>
              <span className="kana text-[15px] leading-[1.3] text-blue">{kana}</span>
            </div>
            <div className="flex gap-2 text-[13px] font-medium text-ink-2">
              <Pill variant="soft" size="sm" onClick={() => setSort(sort === "popular" ? "price-asc" : sort === "price-asc" ? "price-desc" : "popular")} aria-label={`Sort: ${sortLabel}. Change`}>
                Sort: {sortLabel}
              </Pill>
              <Pill variant={tags.length ? "selected" : "soft"} size="sm" onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen}>
                Filter{tags.length ? ` · ${tags.length}` : ""}
              </Pill>
            </div>
          </div>
          {filterOpen && (
            <div className="-mt-2 flex flex-wrap gap-2" role="group" aria-label="Filter by tag">
              {TAGS.map((t) => {
                const on = tags.includes(t.id);
                return (
                  <Pill key={t.id} size="xs" variant={on ? "selected" : "outline"} onClick={() => setTags(on ? tags.filter((x) => x !== t.id) : [...tags, t.id])} aria-pressed={on}>
                    {t.label}
                  </Pill>
                );
              })}
              {tags.length > 0 && <Pill size="xs" variant="ghost" onClick={() => setTags([])}>Clear</Pill>}
            </div>
          )}

          {/* grid / empty states */}
          {!online ? (
            <EmptyState
              icon="☰"
              title="The menu is being prepared"
              body="Our kitchen is connecting the menu right now. Please check back in a moment — or call us to order by phone."
              className="mx-auto w-full max-w-[420px]"
            />
          ) : items.length === 0 ? (
            <EmptyState icon="☰" title="No dishes yet" body="The menu is empty today. Check back soon or call us." className="mx-auto w-full max-w-[420px]" />
          ) : list.length === 0 ? (
            <EmptyState
              icon="⌕"
              title={searching ? `Nothing found for “${query.trim()}”` : "Nothing matches these filters"}
              body={searching ? "Try a shorter word — or browse the categories, the bestseller list is a good place to start." : "Try fewer filters or another category."}
              action={
                <Pill size="sm" onClick={() => { setQuery(""); setTags([]); setCategory(""); }}>
                  Show everything
                </Pill>
              }
              className="mx-auto w-full max-w-[420px]"
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
              {list.map((item, i) => (
                <ProductCard key={item.id} item={item} index={i} disabled={!canOrder} />
              ))}
            </div>
          )}
          {!canOrder && online && (
            <p className="text-center text-[12px] text-muted">Ordering is paused while the kitchen is sold out. <PillLink href="/about" variant="ghost" size="xs" className="px-1">Opening hours →</PillLink></p>
          )}
        </div>
        <CartPanel />
      </div>
    </div>
  );
}
