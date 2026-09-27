"use client";

// BO · Artikel — the item editor, section for section as the canvas lays it out: Basis, Fotos,
// Verkauf, Küche, Recht, Optionen, Empfohlen dazu, plus the live Vorschau and the margin panel.
// One explicit Save (§6.5 direct CRUD); photos are the exception and write through immediately
// because the object is already in the bucket by then (see components/menu/Photos.tsx).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { Chips, Label, MoneyField, NumberField, Row, Section, Select, Switch, TextArea, TextField } from "@/components/menu/Fields";
import { GroupSummary, OptionGroupDialog } from "@/components/menu/OptionGroups";
import { Photos } from "@/components/menu/Photos";
import { Thumb } from "@/components/menu/Thumb";
import { useI18n, type Key } from "@/lib/i18n";
import {
  ALLERGENS, ITEM_TAGS, completeness, contributionCents, duplicateInsert, isStopped, marginPct, photoPaths, suggestSku, wantsSecondPhoto,
  type Allergen, type ItemTag,
} from "@/lib/menu";
import { run, useMenu } from "@/lib/menuStore";
import { euro } from "@/lib/money";
import { toast } from "@/lib/toast";
import type { MenuItemRow, OptionGroup } from "@/lib/types";

type Draft = {
  name_de: string; name_en: string; name_ja: string; transliteration: string;
  description_de: string; description_en: string;
  category_id: string; base_price_cents: number; cost_cents: number | null; sku: string;
  available: boolean; stoplisted: boolean; stock_remaining: number | null; max_per_order: number | null; tags: ItemTag[];
  prep_minutes: number | null; station: string; kitchen_note: string;
  allergens: Allergen[]; weight_g: number | null; kcal_per_100g: number | null; vat_delivery_pct: number; vat_onsite_pct: number;
  recommended_item_ids: string[];
  photos: string[];
  groupIds: string[];
};

function draftOf(item: MenuItemRow | null, fallbackCategory: string, today: string): Draft {
  return {
    name_de: item?.name_de ?? "",
    name_en: item?.name_en ?? "",
    name_ja: item?.name_ja ?? "",
    transliteration: item?.transliteration ?? "",
    description_de: item?.description_de ?? "",
    description_en: item?.description_en ?? "",
    category_id: item?.category_id ?? fallbackCategory,
    base_price_cents: item?.base_price_cents ?? 0,
    cost_cents: item?.cost_cents ?? null,
    sku: item?.sku ?? "",
    available: item?.available ?? true,
    stoplisted: isStopped(item?.stoplist_until ?? null, today),
    stock_remaining: item?.stock_remaining ?? null,
    max_per_order: item?.max_per_order ?? null,
    tags: ((item?.tags ?? []) as string[]).filter((x): x is ItemTag => (ITEM_TAGS as readonly string[]).includes(x)),
    prep_minutes: item?.prep_minutes ?? null,
    station: item?.station ?? "",
    kitchen_note: item?.kitchen_note ?? "",
    allergens: ((item?.allergens ?? []) as string[]).filter((x): x is Allergen => (ALLERGENS as readonly string[]).includes(x)),
    weight_g: item?.weight_g ?? null,
    kcal_per_100g: item?.kcal_per_100g ?? null,
    vat_delivery_pct: item?.vat_delivery_pct ?? 7,
    vat_onsite_pct: item?.vat_onsite_pct ?? 19,
    recommended_item_ids: item?.recommended_item_ids ?? [],
    photos: photoPaths(item?.photos ?? []),
    groupIds: [],
  };
}

export function ItemEditor({ itemId, presetCategoryId = null }: { itemId: string | null; presetCategoryId?: string | null }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const supabase = useSupabase();
  const { items, categories, groups, links, canWrite, today, reload, loading } = useMenu();

  const item = itemId ? items.find((i) => i.id === itemId) ?? null : null;
  const linkedIds = useMemo(
    () => links.filter((l) => l.item_id === itemId).sort((a, b) => a.sort - b.sort).map((l) => l.group_id),
    [links, itemId],
  );

  const [d, setD] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [groupDialog, setGroupDialog] = useState<OptionGroup | "new-own" | null>(null);
  const [recPicker, setRecPicker] = useState(false);
  const [previewTab, setPreviewTab] = useState<"card" | "detail">("card");

  // (Re)seed the draft when the row arrives; never overwrite work in progress.
  useEffect(() => {
    if (d || loading) return;
    if (itemId && !item) return;
    const fallback = (presetCategoryId && categories.some((c) => c.id === presetCategoryId) ? presetCategoryId : categories[0]?.id) ?? "";
    const next = { ...draftOf(item, fallback, today), groupIds: linkedIds };
    if (!itemId) next.sku = suggestSku(categories.find((c) => c.id === fallback)?.slug ?? "it", items.map((i) => i.sku));
    setD(next);
    setBaseline(JSON.stringify(next));
  }, [d, loading, item, itemId, categories, items, linkedIds, today, presetCategoryId]);

  const dirty = Boolean(d) && JSON.stringify(d) !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = useCallback((patch: Partial<Draft>) => setD((x) => (x ? { ...x, ...patch } : x)), []);

  if (loading && !d) return <span className="text-[12px] text-muted">{t("misc.loading")}</span>;
  if (itemId && !item && !loading) {
    return <EmptyState icon="☰" title={t("ie.notFound")} body={t("ie.notFoundBody")} action={<Pill size="sm" onClick={() => router.push("/menu")}>{t("ie.back")}</Pill>} />;
  }
  if (!d) return <span className="text-[12px] text-muted">{t("misc.loading")}</span>;

  const category = categories.find((c) => c.id === d.category_id);
  const margin = marginPct(d.base_price_cents, d.cost_cents);
  const contribution = contributionCents(d.base_price_cents, d.cost_cents);
  const flags = completeness({
    name_de: d.name_de, name_en: d.name_en, description_de: d.description_de, description_en: d.description_en,
    photos: d.photos, allergens: d.allergens,
  });
  const linkedGroups = d.groupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is OptionGroup => Boolean(g));
  const recommended = d.recommended_item_ids.map((id) => items.find((i) => i.id === id)).filter((i): i is MenuItemRow => Boolean(i));

  const guard = (href: string) => {
    if (dirty) setLeaveTo(href);
    else router.push(href);
  }

  /** Persisting `photos` on its own — the upload already happened. */
  const savePhotos = async (next: string[]) => {
    set({ photos: next });
    if (!itemId) return;
    const ok = await run(lang, () => supabase.from("menu_items").update({ photos: next }).eq("id", itemId).select("id"));
    if (ok) {
      setBaseline((b) => {
        try {
          return JSON.stringify({ ...(JSON.parse(b) as Draft), photos: next });
        } catch {
          return b;
        }
      });
      await reload();
    }
  }

  const save = async () => {
    const missing: string[] = [];
    if (!d.name_de.trim()) missing.push(t("ie.nameDe"));
    if (!d.category_id) missing.push(t("ie.category"));
    if (!d.sku.trim()) missing.push(t("ie.sku"));
    if (missing.length) return setErrors(missing);
    if (items.some((i) => i.sku === d.sku.trim() && i.id !== itemId)) return setErrors([t("ie.skuTaken")]);
    setErrors([]);
    setBusy(true);

    const row = {
      name_de: d.name_de.trim(),
      name_en: (d.name_en || d.name_de).trim(),
      name_ja: d.name_ja.trim() || null,
      transliteration: d.transliteration.trim() || null,
      description_de: d.description_de.trim() || null,
      description_en: d.description_en.trim() || null,
      category_id: d.category_id,
      base_price_cents: d.base_price_cents,
      cost_cents: d.cost_cents,
      sku: d.sku.trim(),
      available: d.available,
      stoplist_until: d.stoplisted ? today : null,
      stock_remaining: d.stock_remaining,
      max_per_order: d.max_per_order,
      tags: d.tags,
      prep_minutes: d.prep_minutes,
      station: d.station.trim() || null,
      kitchen_note: d.kitchen_note.trim() || null,
      allergens: d.allergens,
      weight_g: d.weight_g,
      kcal_per_100g: d.kcal_per_100g,
      vat_delivery_pct: d.vat_delivery_pct,
      vat_onsite_pct: d.vat_onsite_pct,
      recommended_item_ids: d.recommended_item_ids,
      photos: d.photos,
    };

    const saved = itemId
      ? await run(lang, () => supabase.from("menu_items").update(row).eq("id", itemId).select("id").single())
      : await run(lang, () => supabase.from("menu_items").insert({ ...row, sort: (items.length + 1) * 10 }).select("id").single());
    if (!saved) return setBusy(false);
    const id = saved.id;

    // Link table: drop what was unlinked, upsert the rest with their new order.
    const removed = linkedIds.filter((g) => !d.groupIds.includes(g));
    if (removed.length) await run(lang, () => supabase.from("menu_item_option_groups").delete().eq("item_id", id).in("group_id", removed).select("item_id"));
    if (d.groupIds.length) {
      const ok = await run(lang, () => supabase.from("menu_item_option_groups").upsert(d.groupIds.map((g, i) => ({ item_id: id, group_id: g, sort: (i + 1) * 10 }))).select("item_id"));
      if (!ok) return setBusy(false);
    }

    setBusy(false);
    toast(t("ie.saved"), "ok");
    await reload();
    if (!itemId) return router.replace(`/menu/item/${id}`);
    setBaseline(JSON.stringify(d));
  }

  const duplicate = async () => {
    if (!item) return;
    const created = await run(lang, () =>
      supabase.from("menu_items").insert(duplicateInsert(item, suggestSku(category?.slug ?? "it", items.map((i) => i.sku)))).select("id").single(),
    );
    if (!created) return;
    toast(t("mi.duplicated"), "ok");
    await reload();
    router.push(`/menu/item/${created.id}`);
  }

  const displayName = lang === "de" ? d.name_de : d.name_en || d.name_de;

  return (
    <div className="screen-in flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => guard("/menu")} aria-label={t("ie.back")} className="flex h-8 w-8 items-center justify-center rounded-full bg-paper text-[14px] text-ink-2 shadow-(--shadow-pill)">
          ‹
        </button>
        <h1 className="min-w-0 truncate">{displayName || t("ie.newTitle")}</h1>
        {dirty && <span className="rounded bg-amber-tint px-2 py-1 text-[9px] font-extrabold tracking-[0.09em] text-orange-ink">{t("ie.unsaved")}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {itemId && canWrite && (
            <Pill variant="ghost" size="sm" onClick={duplicate}>
              {t("ie.duplicate")}
            </Pill>
          )}
          {canWrite && (
            <Pill size="sm" onClick={save} disabled={busy}>
              {busy ? t("ie.saving") : t("ie.save")}
            </Pill>
          )}
        </div>
      </div>

      {!canWrite && <div className="rounded-[14px] bg-sky-tint px-3.5 py-2.5 text-[12px] text-ink-2">{t("menu.readOnly")}</div>}
      {errors.length > 0 && <div className="rounded-[14px] bg-alert-tint px-3.5 py-2.5 text-[12px] font-extrabold text-alert">{t("ie.required", { f: errors.join(" · ") })}</div>}

      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* ── Basis ── */}
          <Section title={t("ie.sec.basis")} hint={d.name_en.trim() ? t("ie.pairOk") : t("ie.pairHint")}>
            <Row>
              <TextField label={t("ie.nameDe")} value={d.name_de} onChange={(v) => set({ name_de: v })} disabled={!canWrite} />
              <TextField label={t("ie.nameEn")} value={d.name_en} onChange={(v) => set({ name_en: v })} disabled={!canWrite} />
            </Row>
            <Row>
              <TextField label={t("ie.nameJa")} value={d.name_ja} onChange={(v) => set({ name_ja: v })} kana hint={t("ie.nameJaHint")} disabled={!canWrite} />
              <TextField label={t("ie.translit")} value={d.transliteration} onChange={(v) => set({ transliteration: v })} hint={t("ie.translitHint")} disabled={!canWrite} />
            </Row>
            <Row>
              <TextArea label={t("ie.descDe")} value={d.description_de} onChange={(v) => set({ description_de: v })} disabled={!canWrite} />
              <TextArea label={t("ie.descEn")} value={d.description_en} onChange={(v) => set({ description_en: v })} placeholder={t("ie.descEnEmpty")} disabled={!canWrite} />
            </Row>
            <Row cols={4}>
              <Select label={t("ie.category")} value={d.category_id} onChange={(v) => set({ category_id: v })} disabled={!canWrite} options={categories.map((c) => ({ value: c.id, label: lang === "de" ? c.name_de : c.name_en }))} />
              <MoneyField label={t("ie.price")} cents={d.base_price_cents} onChange={(c) => set({ base_price_cents: c ?? 0 })} disabled={!canWrite} />
              <MoneyField label={t("ie.cost")} cents={d.cost_cents} onChange={(c) => set({ cost_cents: c })} nullable disabled={!canWrite} />
              <TextField label={t("ie.sku")} value={d.sku} onChange={(v) => set({ sku: v.toUpperCase() })} disabled={!canWrite} />
            </Row>
          </Section>

          {/* ── Fotos ── */}
          <Section title={t("ie.sec.photos")}>
            <Photos itemId={itemId} photos={d.photos} onChange={savePhotos} canWrite={canWrite} />
          </Section>

          {/* ── Verkauf ── */}
          <Section title={t("ie.sec.sales")}>
            <Switch checked={d.available} onChange={(v) => set({ available: v })} label={t("ie.available")} disabled={!canWrite} />
            <Switch checked={d.stoplisted} onChange={(v) => set({ stoplisted: v })} label={t("ie.stoplist")} hint={t("ie.stoplistHint")} disabled={!canWrite} />
            <Row cols={2}>
              <NumberField label={t("ie.stock")} value={d.stock_remaining} onChange={(v) => set({ stock_remaining: v })} placeholder={t("ie.stockNone")} disabled={!canWrite} />
              <NumberField label={t("ie.maxPerOrder")} value={d.max_per_order} onChange={(v) => set({ max_per_order: v })} placeholder={t("ie.stockNone")} disabled={!canWrite} />
            </Row>
            <div className="flex flex-col gap-1.5">
              <Label>{t("ie.tags")}</Label>
              <Chips values={ITEM_TAGS} selected={d.tags} disabled={!canWrite} onToggle={(tag) => set({ tags: d.tags.includes(tag) ? d.tags.filter((x) => x !== tag) : [...d.tags, tag] })} render={(tag) => t(`tag.${tag}` as Key)} />
            </div>
          </Section>

          {/* ── Küche ── */}
          <Section title={t("ie.sec.kitchen")}>
            <Row cols={3}>
              <NumberField label={t("ie.prep")} value={d.prep_minutes} onChange={(v) => set({ prep_minutes: v })} suffix={t("ie.prepUnit")} disabled={!canWrite} />
              <TextField label={t("ie.station")} value={d.station} onChange={(v) => set({ station: v })} placeholder={t("ie.stationNone")} disabled={!canWrite} />
              <TextField label={t("ie.kitchenNote")} value={d.kitchen_note} onChange={(v) => set({ kitchen_note: v })} hint={t("ie.kitchenNoteHint")} disabled={!canWrite} />
            </Row>
          </Section>

          {/* ── Recht ── */}
          <Section title={t("ie.sec.legal")}>
            <div className="flex flex-col gap-1.5">
              <Label>{t("ie.allergens")}</Label>
              <Chips values={ALLERGENS} selected={d.allergens} disabled={!canWrite} onToggle={(a) => set({ allergens: d.allergens.includes(a) ? d.allergens.filter((x) => x !== a) : [...d.allergens, a] })} render={(a) => t(`al.${a}` as Key)} />
            </div>
            <Row cols={4}>
              <NumberField label={t("ie.weight")} value={d.weight_g} onChange={(v) => set({ weight_g: v })} suffix="g" disabled={!canWrite} />
              <NumberField label={t("ie.kcal")} value={d.kcal_per_100g} onChange={(v) => set({ kcal_per_100g: v })} disabled={!canWrite} />
              <Select label={t("ie.vatDelivery")} value={String(d.vat_delivery_pct)} onChange={(v) => set({ vat_delivery_pct: Number(v) })} disabled={!canWrite} options={[{ value: "7", label: "7 %" }, { value: "19", label: "19 %" }]} />
              <Select label={t("ie.vatOnsite")} value={String(d.vat_onsite_pct)} onChange={(v) => set({ vat_onsite_pct: Number(v) })} disabled={!canWrite} options={[{ value: "7", label: "7 %" }, { value: "19", label: "19 %" }]} />
            </Row>
          </Section>

          {/* ── Optionen ── */}
          <Section title={t("ie.sec.options")}>
            {linkedGroups.length === 0 && <span className="text-[12px] text-muted">{t("ie.groupNone")}</span>}
            {linkedGroups.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-[14px] bg-field-2 px-3.5 py-2.5">
                <GroupSummary group={g} />
                <span className={`ml-auto flex-none rounded px-1.5 py-px text-[9px] font-extrabold tracking-[0.06em] ${g.shared ? "bg-sky-tint text-ink-2" : "bg-field text-muted"}`}>
                  {g.shared ? t("ie.groupShared") : t("ie.groupOwn")}
                </span>
                {canWrite && (
                  <>
                    <button type="button" aria-label={t("mi.edit")} onClick={() => setGroupDialog(g)} className="px-1 text-[12px] text-muted transition-micro hover:text-ink">
                      ✎
                    </button>
                    <button type="button" aria-label={t("ie.groupUnlink")} onClick={() => set({ groupIds: d.groupIds.filter((x) => x !== g.id) })} className="px-1 text-[12px] text-muted transition-micro hover:text-alert">
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
            {canWrite && (
              <button type="button" onClick={() => setLinking(true)} className="self-start rounded-[14px] border border-dashed border-line-3 px-3.5 py-2.5 text-[12px] font-extrabold text-orange transition-micro hover:border-orange-line">
                {t("ie.linkGroup")}
              </button>
            )}
          </Section>

          {/* ── Empfohlen dazu ── */}
          <Section title={t("ie.sec.recommended")}>
            <div className="flex flex-wrap gap-2">
              {recommended.length === 0 && <span className="text-[12px] text-muted">{t("ie.recNone")}</span>}
              {recommended.map((r) => (
                <span key={r.id} className="flex items-center gap-2 rounded-full bg-field px-3 py-1.5 text-[12px] font-extrabold">
                  {lang === "de" ? r.name_de : r.name_en || r.name_de}
                  {canWrite && (
                    <button type="button" aria-label={t("ph.remove")} onClick={() => set({ recommended_item_ids: d.recommended_item_ids.filter((x) => x !== r.id) })} className="text-muted transition-micro hover:text-alert">
                      ✕
                    </button>
                  )}
                </span>
              ))}
              {canWrite && (
                <button type="button" onClick={() => setRecPicker(true)} className="rounded-full border border-dashed border-line-3 px-3.5 py-1.5 text-[12px] font-extrabold text-orange transition-micro hover:border-orange-line">
                  {t("ie.recAdd")}
                </button>
              )}
            </div>
          </Section>
        </div>

        {/* ── Vorschau + Marge ── */}
        <aside className="flex w-full flex-col gap-4 xl:w-[300px] xl:flex-none">
          <Section
            title={t("ie.sec.preview")}
            right={
              <span className="ml-auto flex gap-1">
                {(["card", "detail"] as const).map((tab) => (
                  <button key={tab} type="button" onClick={() => setPreviewTab(tab)} className={`rounded-full px-2.5 py-1 text-[11px] transition-micro ${previewTab === tab ? "bg-ink font-extrabold text-cream" : "bg-field font-medium text-ink-2"}`}>
                    {t(tab === "card" ? "ie.previewCard" : "ie.previewDetail")}
                  </button>
                ))}
              </span>
            }
          >
            <div className="rounded-[16px] bg-field-2 p-3">
              <div className="overflow-hidden rounded-[14px] bg-paper">
                <Thumb photos={d.photos} alt={displayName} size={previewTab === "card" ? 0 : 0} className={previewTab === "card" ? "!h-[150px] !w-full" : "!h-[210px] !w-full"} />
                <div className="flex flex-col gap-1 p-3">
                  {d.name_ja && <span className="kana text-[12px] text-muted">{d.name_ja}</span>}
                  <span className="text-[14px] font-extrabold leading-[1.25]">{displayName || "—"}</span>
                  {previewTab === "detail" && (lang === "de" ? d.description_de : d.description_en || d.description_de) && (
                    <span className="text-[11px] leading-[1.5] text-ink-3">{lang === "de" ? d.description_de : d.description_en || d.description_de}</span>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[15px] font-extrabold">{euro(d.base_price_cents, lang)}</span>
                    <span className="rounded-full bg-orange px-3 py-1.5 text-[11px] font-extrabold text-white shadow-(--shadow-cta)">{t("ie.add")}</span>
                  </div>
                  {d.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {d.tags.map((tag) => (
                        <span key={tag} className="rounded bg-sand px-1.5 py-px text-[9px] font-extrabold tracking-[0.06em] text-orange-ink">
                          {t(`tag.${tag}` as Key)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={`rounded-[14px] px-3.5 py-2.5 ${flags.length ? "bg-amber-tint" : "bg-ok-tint"}`}>
              <span className="block text-[9px] font-extrabold tracking-[0.09em] text-ink-2">{flags.length ? t("ie.incomplete") : t("ie.complete")}</span>
              <span className="mt-1 block text-[11px] leading-[1.5] text-ink-3">
                {[...flags.map((f) => t(`ie.flag.${f}` as Key)), ...(wantsSecondPhoto(d.photos) ? [t("ie.flag.second_photo")] : [])].join(" · ") || "—"}
              </span>
            </div>
          </Section>

          <Section title={t("ie.margin")}>
            {margin == null ? (
              <span className="text-[12px] text-muted">{t("ie.marginNone")}</span>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-[26px] font-extrabold leading-[1.1]">{margin.toFixed(1)} %</span>
                <span className="text-[12px] text-ink-3">
                  <b className="font-extrabold">{euro(contribution ?? 0, lang)}</b> {t("ie.contribution")}
                </span>
              </div>
            )}
            <span className="text-[11px] text-muted">{t("ie.soldPending")}</span>
          </Section>
        </aside>
      </div>

      {/* link a shared group / create an own one */}
      {linking && (
        <Modal open onClose={() => setLinking(false)} title={t("og.linkTitle")}>
          <div className="flex flex-col gap-2">
            {groups.filter((g) => g.shared && !d.groupIds.includes(g.id)).length === 0 && <span className="text-[12px] text-muted">{t("og.linkNone")}</span>}
            {groups
              .filter((g) => g.shared && !d.groupIds.includes(g.id))
              .map((g) => (
                <button key={g.id} type="button" onClick={() => { set({ groupIds: [...d.groupIds, g.id] }); setLinking(false); }} className="flex items-center gap-2 rounded-[14px] bg-field-2 px-3.5 py-2.5 text-left transition-micro hover:bg-field">
                  <GroupSummary group={g} />
                  <span className="ml-auto text-[11px] font-extrabold text-orange">{t("og.link")}</span>
                </button>
              ))}
            <Pill variant="ghost" size="sm" className="self-start" onClick={() => { setLinking(false); setGroupDialog("new-own"); }}>
              {t("og.linkNew")}
            </Pill>
          </div>
        </Modal>
      )}

      {groupDialog && (
        <OptionGroupDialog
          group={groupDialog === "new-own" ? null : groupDialog}
          forceOwn={groupDialog === "new-own"}
          onClose={() => setGroupDialog(null)}
          onSaved={(id) => set({ groupIds: d.groupIds.includes(id) ? d.groupIds : [...d.groupIds, id] })}
        />
      )}

      {recPicker && (
        <Modal open onClose={() => setRecPicker(false)} title={t("ie.recPick")}>
          <ul className="flex max-h-[420px] flex-col gap-1 overflow-auto">
            {items
              .filter((i) => i.id !== itemId && !d.recommended_item_ids.includes(i.id))
              .map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => { set({ recommended_item_ids: [...d.recommended_item_ids, i.id] }); setRecPicker(false); }} className="flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left transition-micro hover:bg-field-2">
                    <Thumb photos={i.photos} alt={i.name_de} size={32} />
                    <span className="truncate text-[13px] font-extrabold">{lang === "de" ? i.name_de : i.name_en || i.name_de}</span>
                    <span className="ml-auto flex-none text-[12px] text-muted">{euro(i.base_price_cents, lang)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </Modal>
      )}

      {leaveTo && (
        <Modal open onClose={() => setLeaveTo(null)} title={t("ie.leaveTitle")}>
          <div className="flex flex-col gap-4">
            <span className="text-[13px] leading-[1.55] text-ink-3">{t("ie.leaveBody")}</span>
            <div className="flex justify-end gap-2">
              <Pill variant="ghost" size="sm" onClick={() => setLeaveTo(null)}>
                {t("ie.leaveStay")}
              </Pill>
              <Pill variant="alert" size="sm" onClick={() => router.push(leaveTo)}>
                {t("ie.leaveGo")}
              </Pill>
            </div>
          </div>
        </Modal>
      )}

      <Link href="/menu" onClick={(e) => { e.preventDefault(); guard("/menu"); }} className="text-[12px] font-extrabold text-muted transition-micro hover:text-ink">
        ‹ {t("ie.back")}
      </Link>
    </div>
  );
}
