"use client";

// Artikelliste of BO · Speisekarte: thumb, name + kana, category, price, cost, margin, the
// availability toggle, "Stoppliste bis Mitternacht" and the design's "unvollständig" flags.
// `VERKAUFT` is deliberately absent — there is no reports view yet (S2-03), and a faked number on a
// menu screen is worse than a missing column.
import Link from "next/link";
import { useMemo, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { BulkBar, UndoBar, type UndoPlan } from "@/components/menu/BulkActions";
import { Thumb } from "@/components/menu/Thumb";
import { useI18n, type Key } from "@/lib/i18n";
import { PHOTO_BUCKET, completeness, duplicateInsert, filterItems, isStopped, marginPct, objectKeyOf, photoPaths, suggestSku, type CompletenessFlag, type ItemFilter } from "@/lib/menu";
import { run, useMenu } from "@/lib/menuStore";
import { euro } from "@/lib/money";
import { toast } from "@/lib/toast";
import type { MenuItemRow } from "@/lib/types";

const FILTERS: { value: ItemFilter; key: Key }[] = [
  { value: "all", key: "mi.filter.all" },
  { value: "active", key: "mi.filter.active" },
  { value: "stoplist", key: "mi.filter.stoplist" },
  { value: "incomplete", key: "mi.filter.incomplete" },
];

const FLAG_BADGE: Record<CompletenessFlag, Key> = {
  name_en: "mi.noNameEn",
  description_en: "mi.noDescEn",
  photo: "mi.noPhoto",
  allergens: "mi.noAllergens",
};

export function ItemsTable({ categoryId, onCreateItem }: { categoryId: string | null; onCreateItem: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { items, categories, canWrite, today, reload } = useMenu();
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ plan: UndoPlan; message: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MenuItemRow | null>(null);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const rows = useMemo(
    () => filterItems(items, { filter, query, categoryId, today, categories: catMap }),
    [items, filter, query, categoryId, today, catMap],
  ) as MenuItemRow[];

  const selection = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && selection.length === rows.length;

  async function toggleAvailable(item: MenuItemRow) {
    const ok = await run(lang, () => supabase.from("menu_items").update({ available: !item.available }).eq("id", item.id).select("id"));
    if (ok) await reload();
  }

  async function toggleStoplist(item: MenuItemRow) {
    const next = isStopped(item.stoplist_until, today) ? null : today;
    const ok = await run(lang, () => supabase.from("menu_items").update({ stoplist_until: next }).eq("id", item.id).select("id"));
    if (ok) await reload();
  }

  async function duplicate(item: MenuItemRow) {
    const slug = catMap.get(item.category_id)?.slug ?? "it";
    const created = await run(lang, () =>
      supabase.from("menu_items").insert(duplicateInsert(item, suggestSku(slug, items.map((i) => i.sku)))).select("id"),
    );
    if (!created) return;
    toast(t("mi.duplicated"), "ok");
    await reload();
  }

  async function remove(item: MenuItemRow) {
    // The objects are not cascaded by the bucket (§6.8) — drop them first, then the row.
    const keys = photoPaths(item.photos).map(objectKeyOf).filter((k): k is string => Boolean(k));
    if (keys.length) await supabase.storage.from(PHOTO_BUCKET).remove(keys);
    const ok = await run(lang, () => supabase.from("menu_items").delete().eq("id", item.id).select("id"));
    setDeleting(null);
    if (!ok) return;
    toast(t("mi.deleted"), "ok");
    setSelected((s) => {
      const next = new Set(s);
      next.delete(item.id);
      return next;
    });
    await reload();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[200px] flex-1 items-center">
          <span className="pointer-events-none absolute left-3.5 text-[13px] text-muted-2" aria-hidden>⌕</span>
          <input className="field pl-9" placeholder={t("menu.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3.5 py-2 text-[12px] transition-micro ${filter === f.value ? "bg-ink font-extrabold text-cream" : "bg-paper font-medium text-ink-2 shadow-(--shadow-pill) hover:text-ink"}`}
            >
              {t(f.key)}
            </button>
          ))}
        </div>
      </div>

      {canWrite && selection.length > 0 && (
        <BulkBar
          selection={selection}
          onClear={() => setSelected(new Set())}
          onUndoPlan={(plan, message) => setUndo({ plan, message })}
        />
      )}
      {undo && <UndoBar plan={undo.plan} message={undo.message} onClear={() => setUndo(null)} />}

      {rows.length === 0 ? (
        query.trim() ? (
          <EmptyState icon="⌕" title={t("menu.noMatch")} body={t("menu.noMatchBody", { q: query })} action={<Pill size="sm" variant="ghost" onClick={() => { setQuery(""); setFilter("all"); }}>{t("menu.resetFilters")}</Pill>} />
        ) : (
          <EmptyState
            icon="☰"
            title={t("cat.emptyTitle")}
            body={t("cat.emptyBody", { c: categoryId ? (lang === "de" ? catMap.get(categoryId)?.name_de : catMap.get(categoryId)?.name_en) ?? "" : t("cat.all") })}
            action={canWrite ? <Pill size="sm" onClick={onCreateItem}>{t("cat.emptyCta")}</Pill> : undefined}
          />
        )
      ) : (
        <div className="card overflow-x-auto rounded-[18px]">
          <table className="w-full min-w-[840px] border-collapse">
            <thead>
              <tr className="border-b border-line text-left">
                {canWrite && (
                  <th className="w-9 py-3 pl-4">
                    <input
                      type="checkbox"
                      aria-label={t("mi.selectAll")}
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                  </th>
                )}
                <th className="label-caps py-3 pl-3">{t("mi.th.item")}</th>
                <th className="label-caps py-3">{t("mi.th.category")}</th>
                <th className="label-caps py-3 text-right">{t("mi.th.price")}</th>
                <th className="label-caps py-3 text-right">{t("mi.th.cost")}</th>
                <th className="label-caps py-3 text-right">{t("mi.th.margin")}</th>
                <th className="label-caps py-3 pl-4">{t("mi.th.actions")}</th>
                <th className="label-caps py-3 pr-4 text-right">{t("mi.th.available")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const cat = catMap.get(item.category_id);
                const stopped = isStopped(item.stoplist_until, today);
                const flags = completeness(item);
                const margin = marginPct(item.base_price_cents, item.cost_cents);
                return (
                  <tr key={item.id} className="border-b border-line last:border-0 transition-micro hover:bg-field-2">
                    {canWrite && (
                      <td className="py-2.5 pl-4 align-middle">
                        <input
                          type="checkbox"
                          aria-label={item.name_de}
                          checked={selected.has(item.id)}
                          onChange={() =>
                            setSelected((s) => {
                              const next = new Set(s);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                        />
                      </td>
                    )}
                    <td className="py-2.5 pl-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Thumb photos={item.photos} alt={item.name_de} />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <Link href={`/menu/item/${item.id}`} className="truncate text-[13px] font-extrabold hover:text-orange">
                            {lang === "de" ? item.name_de : item.name_en || item.name_de}
                          </Link>
                          <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                            {item.name_ja && <span className="kana">{item.name_ja}</span>}
                            <span>{item.sku}</span>
                            {stopped && <Flag tone="alert">{t("mi.stopToday")}</Flag>}
                            {!item.available && <Flag tone="muted">{t("mi.hidden")}</Flag>}
                            {cat && !cat.active && <Flag tone="muted">{t("mi.catHidden")}</Flag>}
                            {flags.map((f) => (
                              <Flag key={f} tone="amber">
                                {t(FLAG_BADGE[f])}
                              </Flag>
                            ))}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 text-[12px] text-ink-3">{cat ? (lang === "de" ? cat.name_de : cat.name_en) : "—"}</td>
                    <td className="py-2.5 text-right text-[13px] font-extrabold">{euro(item.base_price_cents, lang)}</td>
                    <td className="py-2.5 text-right text-[12px] text-ink-3">{item.cost_cents == null ? "—" : euro(item.cost_cents, lang)}</td>
                    <td className="py-2.5 text-right text-[12px] font-extrabold text-ink-2">{margin == null ? "—" : `${margin.toFixed(1)} %`}</td>
                    <td className="py-2.5 pl-4">
                      <div className="flex items-center gap-1 text-[13px] text-muted">
                        <Link href={`/menu/item/${item.id}`} title={t("mi.edit")} aria-label={t("mi.edit")} className="px-1 transition-micro hover:text-ink">
                          ✎
                        </Link>
                        {canWrite && (
                          <>
                            <button type="button" title={t("mi.duplicate")} aria-label={t("mi.duplicate")} onClick={() => duplicate(item)} className="px-1 transition-micro hover:text-ink">
                              ⧉
                            </button>
                            <button
                              type="button"
                              title={stopped ? t("mi.unstoplist") : t("mi.stoplist")}
                              aria-label={stopped ? t("mi.unstoplist") : t("mi.stoplist")}
                              onClick={() => toggleStoplist(item)}
                              className={`px-1 transition-micro hover:text-ink ${stopped ? "text-alert" : ""}`}
                            >
                              ⊘
                            </button>
                            <span className="relative">
                              <button type="button" aria-label="…" onClick={() => setMenuFor(menuFor === item.id ? null : item.id)} className="px-1 transition-micro hover:text-ink">
                                ⋯
                              </button>
                              {menuFor === item.id && (
                                <span className="absolute right-0 top-6 z-20 flex w-[170px] flex-col overflow-hidden rounded-[12px] bg-paper py-1 text-left shadow-(--shadow-modal)">
                                  <button type="button" className="px-3 py-2 text-left text-[12px] transition-micro hover:bg-field-2" onClick={() => { setMenuFor(null); setDeleting(item); }}>
                                    {t("mi.delete")}
                                  </button>
                                </span>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.available}
                        aria-label={item.available ? t("mi.availableOn") : t("mi.availableOff")}
                        disabled={!canWrite}
                        onClick={() => toggleAvailable(item)}
                        className={`inline-block h-[22px] w-[38px] rounded-full p-[3px] transition-micro ${item.available ? "bg-ok" : "bg-field shadow-(--shadow-inset)"}`}
                      >
                        <span className={`block h-4 w-4 rounded-full bg-paper shadow-(--shadow-pill) transition-micro ${item.available ? "translate-x-4" : ""}`} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <span className="text-[11px] text-muted">{t("mi.soldMissing")}</span>

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={t("mi.deleteTitle")}>
          <div className="flex flex-col gap-4">
            <span className="text-[13px] leading-[1.55] text-ink-3">{t("mi.deleteBody", { n: deleting.name_de })}</span>
            <div className="flex justify-end gap-2">
              <Pill variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                {t("bulk.cancel")}
              </Pill>
              <Pill variant="alert" size="sm" onClick={() => remove(deleting)}>
                {t("mi.delete")}
              </Pill>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Flag({ tone, children }: { tone: "alert" | "amber" | "muted"; children: React.ReactNode }) {
  const c = { alert: "bg-alert-tint text-alert", amber: "bg-amber-tint text-orange-ink", muted: "bg-field text-muted" }[tone];
  return <span className={`rounded px-1.5 py-px text-[9px] font-extrabold tracking-[0.06em] ${c}`}>{children}</span>;
}
