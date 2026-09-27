"use client";

// Bulk actions on the Artikelliste (BO · Speisekarte). Every action is ONE confirmed request —
// a single `upsert` / `insert` of the whole selection, never a loop of per-row writes — and every
// action keeps the rows it replaced so "Rückgängig" can put them back with the same single call.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { Label, Select } from "@/components/menu/Fields";
import { useI18n } from "@/lib/i18n";
import { applyPricePct, duplicateInsert, isStopped, suggestSku } from "@/lib/menu";
import { run, useMenu } from "@/lib/menuStore";
import { euro } from "@/lib/money";
import { toast } from "@/lib/toast";
import type { MenuItemRow } from "@/lib/types";

export type BulkKind = "price" | "move" | "hide" | "show" | "stoplist" | "unstoplist" | "duplicate";

/** What "Rückgängig" needs: either the rows to write back, or the ids to delete again. */
export type UndoPlan = { restore: MenuItemRow[] } | { deleteIds: string[] };

export function BulkBar({
  selection, onClear, onUndoPlan,
}: {
  selection: MenuItemRow[];
  onClear: () => void;
  onUndoPlan: (plan: UndoPlan, message: string) => void;
}) {
  const { t } = useI18n();
  const { today } = useMenu();
  const [kind, setKind] = useState<BulkKind | null>(null);
  const n = selection.length;
  if (!n) return null;

  const allStopped = selection.every((i) => isStopped(i.stoplist_until, today));
  const allHidden = selection.every((i) => !i.available);

  return (
    <>
      <div className="screen-in flex flex-wrap items-center gap-2 rounded-[16px] bg-ink px-3.5 py-2.5 text-cream">
        <span className="text-[12px] font-extrabold">{t("mi.selected", { n })}</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <BulkButton onClick={() => setKind("price")}>{t("bulk.price")}</BulkButton>
          <BulkButton onClick={() => setKind("move")}>{t("bulk.move")}</BulkButton>
          <BulkButton onClick={() => setKind(allHidden ? "show" : "hide")}>{allHidden ? t("bulk.show") : t("bulk.hide")}</BulkButton>
          <BulkButton onClick={() => setKind(allStopped ? "unstoplist" : "stoplist")}>{t("bulk.stoplist")}</BulkButton>
          <BulkButton onClick={() => setKind("duplicate")}>{t("bulk.duplicate")}</BulkButton>
          <button type="button" onClick={onClear} className="rounded-full px-3 py-1.5 text-[11px] font-medium text-nav-text transition-micro hover:text-cream">
            {t("mi.clearSelection")}
          </button>
        </div>
      </div>
      {kind && <BulkDialog kind={kind} selection={selection} onClose={() => setKind(null)} onDone={onClear} onUndoPlan={onUndoPlan} />}
    </>
  );
}

function BulkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full bg-nav-track px-3 py-1.5 text-[11px] font-extrabold text-cream transition-micro hover:brightness-125">
      {children}
    </button>
  );
}

function BulkDialog({
  kind, selection, onClose, onDone, onUndoPlan,
}: {
  kind: BulkKind; selection: MenuItemRow[]; onClose: () => void; onDone: () => void; onUndoPlan: (plan: UndoPlan, message: string) => void;
}) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { categories, items, reload, today } = useMenu();
  const [pct, setPct] = useState(10);
  const [sign, setSign] = useState<"+" | "−">("+");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const n = selection.length;
  const signed = sign === "+" ? pct : -pct;

  const copy: Record<BulkKind, { title: string; body: string }> = {
    price: { title: t("bulk.priceTitle"), body: t("bulk.priceBody", { n }) },
    move: { title: t("bulk.moveTitle"), body: t("bulk.moveBody", { n }) },
    hide: { title: t("bulk.hideTitle"), body: t("bulk.hideBody", { n }) },
    show: { title: t("bulk.showTitle"), body: t("bulk.showBody", { n }) },
    stoplist: { title: t("bulk.stoplistTitle"), body: t("bulk.stoplistBody", { n }) },
    unstoplist: { title: t("bulk.unstoplistTitle"), body: t("bulk.unstoplistBody", { n }) },
    duplicate: { title: t("bulk.duplicateTitle"), body: t("bulk.duplicateBody", { n }) },
  };

  function nextRows(): MenuItemRow[] {
    switch (kind) {
      case "price":
        return selection.map((i) => ({ ...i, base_price_cents: applyPricePct(i.base_price_cents, signed) }));
      case "move":
        return selection.map((i) => ({ ...i, category_id: categoryId }));
      case "hide":
        return selection.map((i) => ({ ...i, available: false }));
      case "show":
        return selection.map((i) => ({ ...i, available: true }));
      case "stoplist":
        return selection.map((i) => ({ ...i, stoplist_until: today }));
      default:
        return selection.map((i) => ({ ...i, stoplist_until: null }));
    }
  }

  async function apply() {
    setBusy(true);
    if (kind === "duplicate") {
      const skus = items.map((i) => i.sku);
      const copies = selection.map((i) => {
        const slug = categories.find((c) => c.id === i.category_id)?.slug ?? "it";
        const sku = suggestSku(slug, skus);
        skus.push(sku);
        return duplicateInsert(i, sku);
      });
      const created = await run(lang, () => supabase.from("menu_items").insert(copies).select("id"));
      setBusy(false);
      if (!created) return;
      onUndoPlan({ deleteIds: created.map((r) => r.id) }, t("bulk.doneDuplicate", { n: created.length }));
    } else {
      const rows = nextRows();
      const saved = await run(lang, () => supabase.from("menu_items").upsert(rows).select("id"));
      setBusy(false);
      if (!saved) return;
      onUndoPlan({ restore: selection }, t("bulk.done", { n }));
    }
    await reload();
    onDone();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={copy[kind].title}>
      <div className="flex flex-col gap-3.5">
        <span className="text-[13px] leading-[1.55] text-ink-3">{copy[kind].body}</span>

        {kind === "price" && (
          <div className="flex flex-col gap-2.5">
            <Label>{t("bulk.pricePct")}</Label>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {(["+", "−"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSign(s)}
                    className={`h-[38px] w-[38px] rounded-full text-[14px] font-extrabold transition-micro ${sign === s ? "bg-ink text-cream" : "bg-field text-ink-2"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                max={90}
                className="field max-w-[110px]"
                value={pct}
                onChange={(e) => setPct(Math.min(90, Math.max(0, Math.trunc(Number(e.target.value) || 0))))}
              />
              <span className="text-[13px] font-extrabold text-muted">%</span>
            </div>
            <ul className="max-h-[180px] overflow-auto rounded-[14px] bg-field-2 p-3 text-[12px] leading-[1.6] text-ink-3">
              {selection.slice(0, 12).map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span className="truncate">{i.name_de}</span>
                  <span className="flex-none font-extrabold text-ink">
                    {t("bulk.pricePreview", { a: euro(i.base_price_cents, lang), b: euro(applyPricePct(i.base_price_cents, signed), lang) })}
                  </span>
                </li>
              ))}
              {selection.length > 12 && <li className="pt-1 text-muted">+ {selection.length - 12}</li>}
            </ul>
          </div>
        )}

        {kind === "move" && (
          <Select
            label={t("ie.category")}
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: lang === "de" ? c.name_de : c.name_en }))}
          />
        )}

        <div className="flex justify-end gap-2">
          <Pill variant="ghost" size="sm" onClick={onClose}>
            {t("bulk.cancel")}
          </Pill>
          <Pill size="sm" onClick={apply} disabled={busy || (kind === "move" && !categoryId)}>
            {busy ? t("ie.saving") : t("bulk.confirm")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}

/** The strip under the toolbar after a bulk action: what happened + the inverse, one call again. */
export function UndoBar({ plan, message, onClear }: { plan: UndoPlan; message: string; onClear: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { reload } = useMenu();
  const [busy, setBusy] = useState(false);

  async function undo() {
    setBusy(true);
    const ok =
      "restore" in plan
        ? await run(lang, () => supabase.from("menu_items").upsert(plan.restore).select("id"))
        : await run(lang, () => supabase.from("menu_items").delete().in("id", plan.deleteIds).select("id"));
    setBusy(false);
    if (!ok) return;
    toast(t("bulk.undone"), "ok");
    await reload();
    onClear();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[16px] bg-ok-tint px-3.5 py-2.5">
      <span className="text-[12px] font-extrabold text-ink">{message}</span>
      <div className="ml-auto flex gap-1.5">
        <Pill variant="ghost" size="xs" onClick={undo} disabled={busy}>
          {t("bulk.undo")}
        </Pill>
        <button type="button" onClick={onClear} aria-label="ok" className="px-2 text-[12px] text-muted">
          ✕
        </button>
      </div>
    </div>
  );
}
