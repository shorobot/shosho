"use client";

// Bulk actions on the Kunden list. Same shape as the Artikelliste's BulkBar: every action is ONE
// confirmed request — a single upsert of the whole selection, never a loop of per-row writes — and it
// keeps the rows it replaced so "Rückgängig" can put them back with the same single call.
//
// Only the two actions that have a backend are live. "Push senden" and "Gutschein senden" are in the
// design and have no messaging channel (S5) and no voucher issuing (S2-06) behind them, so they render
// disabled with a tooltip naming what is missing — a button that lies is worse than one that explains
// itself.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Label, Select } from "@/components/menu/Fields";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { consentsOf, effectiveDaysSilent, TAGS, withTag, type Tag } from "@/lib/crm";
import { run, useCrm, type CrmRow } from "@/lib/crmStore";
import { downloadText, toCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Customer, CustomerRow } from "@/lib/types";

/** What "Rückgängig" needs: the customer rows as they were before the write. */
export type CrmUndoPlan = { restore: CustomerRow[] };

/**
 * A `customers` row without the nested address relation, which PostgREST cannot upsert. Dropping it
 * here rather than at the call site keeps every write path honest about what it actually sends.
 */
function writable({ customer_addresses, ...row }: Customer): CustomerRow {
  void customer_addresses; // destructured only to leave it out of the payload
  return row;
}

export function CrmBulkBar({
  selection, onClear, onUndoPlan,
}: {
  selection: CrmRow[];
  onClear: () => void;
  onUndoPlan: (plan: CrmUndoPlan, message: string) => void;
}) {
  const { t, lang } = useI18n();
  const { now } = useCrm();
  const [tagOpen, setTagOpen] = useState(false);
  const n = selection.length;
  if (!n) return null;

  function exportCsv() {
    const header = ["name", "phone", "email", "is_company", "tags", "orders", "spent_cents", "avg_cents", "last_order_at", "days_silent", "cancelled_count", "consent_email", "consent_push", "consent_phone"];
    const rows = selection.map((r) => {
      const consents = consentsOf(r.customer);
      return [
        r.customer.name, r.customer.phone, r.customer.email, String(r.customer.is_company), r.customer.tags.join(" "),
        r.stats.orders_count, r.stats.spent_cents, r.stats.avg_cents, r.stats.last_order_at,
        effectiveDaysSilent(r.stats, now), r.stats.cancelled_count,
        ...consents.map((c) => (c.granted ? (c.grantedAt ?? "granted") : "")),
      ];
    });
    downloadText(`shosho-kunden-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([header, ...rows]));
  }

  return (
    <>
      <div className="screen-in flex flex-wrap items-center gap-2 rounded-[16px] bg-ink px-3.5 py-2.5 text-cream">
        <span className="text-[12px] font-extrabold">{t("cb.selected", { n })}</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <BulkButton onClick={() => setTagOpen(true)}>{t("cb.tag")}</BulkButton>
          <BulkButton onClick={exportCsv}>{t("cb.export")}</BulkButton>
          <BulkButton disabled title={t("cb.pushUnavailable")}>{t("cb.push")}</BulkButton>
          <BulkButton disabled title={t("cb.voucherUnavailable")}>{t("cb.voucher")}</BulkButton>
          <button type="button" onClick={onClear} className="rounded-full px-3 py-1.5 text-[11px] font-medium text-nav-text transition-micro hover:text-cream">
            {t("cb.clear")}
          </button>
        </div>
      </div>
      {tagOpen && (
        <TagDialog
          selection={selection}
          onClose={() => setTagOpen(false)}
          onDone={onClear}
          onUndoPlan={onUndoPlan}
          lang={lang}
        />
      )}
    </>
  );
}

function BulkButton({
  onClick, children, disabled = false, title,
}: {
  onClick?: () => void; children: React.ReactNode; disabled?: boolean; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold transition-micro ${
        disabled ? "cursor-not-allowed bg-nav-track/40 text-nav-text" : "bg-nav-track text-cream hover:brightness-125"
      }`}
    >
      {children}
      {disabled && " ·"}
    </button>
  );
}

function TagDialog({
  selection, onClose, onDone, onUndoPlan, lang,
}: {
  selection: CrmRow[]; onClose: () => void; onDone: () => void; onUndoPlan: (plan: CrmUndoPlan, message: string) => void; lang: "de" | "en";
}) {
  const { t } = useI18n();
  const supabase = useSupabase();
  const { reload } = useCrm();
  const [tag, setTag] = useState<Tag>("VIP");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [busy, setBusy] = useState(false);
  const n = selection.length;

  async function apply() {
    setBusy(true);
    const before = selection.map((r) => writable(r.customer));
    const next = before.map((c) => ({ ...c, tags: withTag(c.tags, tag, mode === "add") }));
    // One upsert for the whole selection. Each row carries its own new tag array, which a single
    // `update` could not express; the trade is that these rows are the snapshot this screen loaded,
    // so a column another operator changed in the meantime is written back as we saw it.
    const saved = await run(lang, () => supabase.from("customers").upsert(next).select("id"));
    setBusy(false);
    if (!saved) return;
    onUndoPlan({ restore: before }, t("cb.done", { n }));
    await reload();
    onDone();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={t("cb.tagTitle", { n })}>
      <div className="flex flex-col gap-3.5">
        <span className="text-[13px] leading-[1.55] text-ink-3">{t("cb.tagBody")}</span>
        <Select
          label={t("cb.tag")}
          value={tag}
          onChange={setTag}
          options={TAGS.map((v) => ({ value: v, label: v }))}
        />
        <div className="flex flex-col gap-2">
          <Label>{t("cb.tag")}</Label>
          <div className="flex gap-1.5">
            {(["add", "remove"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`rounded-full px-3.5 py-2 text-[12px] transition-micro ${mode === m ? "bg-ink font-extrabold text-cream" : "bg-field font-medium text-ink-2"}`}
              >
                {m === "add" ? t("cb.tagAdd") : t("cb.tagRemove")}
              </button>
            ))}
          </div>
        </div>
        <ul className="max-h-[180px] overflow-auto rounded-[14px] bg-field-2 p-3 text-[12px] leading-[1.6] text-ink-3">
          {selection.slice(0, 12).map((r) => (
            <li key={r.customer.id} className="truncate">
              {r.customer.name}
            </li>
          ))}
          {n > 12 && <li className="pt-1 text-muted">+ {n - 12}</li>}
        </ul>
        <div className="flex justify-end gap-2">
          <Pill variant="ghost" size="sm" onClick={onClose}>
            {t("cb.cancel")}
          </Pill>
          <Pill size="sm" onClick={apply} disabled={busy}>
            {busy ? t("cb.working") : t("cb.confirm")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}

/** The strip under the toolbar after a bulk action: what happened + the inverse, one call again. */
export function CrmUndoBar({ plan, message, onClear }: { plan: CrmUndoPlan; message: string; onClear: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { reload } = useCrm();
  const [busy, setBusy] = useState(false);

  async function undo() {
    setBusy(true);
    const ok = await run(lang, () => supabase.from("customers").upsert(plan.restore).select("id"));
    setBusy(false);
    if (!ok) return;
    toast(t("cb.undone"), "ok");
    await reload();
    onClear();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[16px] bg-ok-tint px-3.5 py-2.5">
      <span className="text-[12px] font-extrabold text-ink">{message}</span>
      <div className="ml-auto flex gap-1.5">
        <Pill variant="ghost" size="xs" onClick={undo} disabled={busy}>
          {t("cb.undo")}
        </Pill>
        <button type="button" onClick={onClear} aria-label="ok" className="px-2 text-[12px] text-muted">
          ✕
        </button>
      </div>
    </div>
  );
}
