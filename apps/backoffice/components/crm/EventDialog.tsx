"use client";

// "Notiz / Beschwerde / Kompensation" on the profile → rpc('add_customer_event', …) (§6.8).
//
// Writes go through the RPC, never through the table: `customer_events` has a staff **read** policy
// and no write policy for anyone, so a direct insert is refused by design (/docs/security.md §2). The
// RPC gates on owner/operator itself and stamps the actor.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Label, MoneyField, Select, TextArea } from "@/components/menu/Fields";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { run } from "@/lib/crmStore";
import { useI18n, type Key } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { ddmm } from "@/lib/time";
import type { Json, Order } from "@/lib/types";

export type EventKind = "note" | "complaint" | "compensation";
type CompensationKind = "voucher" | "refund" | "free_item";

const TITLE: Record<EventKind, Key> = {
  note: "cd.noteTitle",
  complaint: "cd.complaintTitle",
  compensation: "cd.compensationTitle",
};

export function EventDialog({
  kind, customerId, orders, onClose, onSaved,
}: {
  kind: EventKind;
  customerId: string;
  orders: Order[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const [text, setText] = useState("");
  const [compKind, setCompKind] = useState<CompensationKind>("voucher");
  const [cents, setCents] = useState<number | null>(500);
  const [orderId, setOrderId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // add_customer_event raises invalid_input when payload.text is blank for a note or a complaint;
  // a compensation's text is optional (§6.8). Checked here so the operator sees the reason in the
  // dialog instead of a toast carrying a Postgres error.
  const textRequired = kind === "note" || kind === "complaint";

  async function save() {
    if (textRequired && text.trim() === "") {
      setError(t("cd.textRequired"));
      return;
    }
    setBusy(true);
    const payload: Record<string, Json> =
      kind === "compensation"
        ? {
            kind: compKind,
            ...(cents == null ? {} : { amount_cents: cents }),
            ...(text.trim() ? { text: text.trim() } : {}),
            ...(orderId ? { order_id: orderId } : {}),
          }
        : {
            text: text.trim(),
            ...(orderId ? { order_id: orderId } : {}),
          };
    const ok = await run(lang, () => supabase.rpc("add_customer_event", { customer_id: customerId, type: kind, payload }));
    setBusy(false);
    if (!ok) return;
    toast(t("cd.added"), "ok");
    onClose();
    await onSaved();
  }

  return (
    <Modal open onClose={onClose} title={t(TITLE[kind])}>
      <div className="flex flex-col gap-3.5">
        {kind === "compensation" && (
          <>
            <Select
              label={t("cd.compensationKind")}
              value={compKind}
              onChange={setCompKind}
              options={[
                { value: "voucher" as CompensationKind, label: t("cd.kindVoucher") },
                { value: "refund" as CompensationKind, label: t("cd.kindRefund") },
                { value: "free_item" as CompensationKind, label: t("cd.kindFreeItem") },
              ]}
            />
            <MoneyField label={t("cd.compensationAmount")} cents={cents} onChange={setCents} nullable />
          </>
        )}

        <TextArea
          label={kind === "complaint" ? t("cd.complaintLabel") : kind === "note" ? t("cd.noteLabel") : t("cd.compensationNote")}
          value={text}
          onChange={(v) => {
            setText(v);
            setError(null);
          }}
          placeholder={kind === "complaint" ? t("cd.complaintPlaceholder") : kind === "note" ? t("cd.notePlaceholder") : ""}
          rows={3}
        />

        {orders.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("cd.orderRef")}</Label>
            <select className="field appearance-none pr-8" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">{t("cd.orderRefNone")}</option>
              {orders.slice(0, 40).map((o) => (
                <option key={o.id} value={o.id}>
                  #{o.number} · {ddmm(o.created_at)}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <span className="text-[11px] font-extrabold text-alert">{error}</span>}

        <div className="flex justify-end gap-2">
          <Pill variant="ghost" size="sm" onClick={onClose}>
            {t("cd.cancel")}
          </Pill>
          <Pill size="sm" onClick={save} disabled={busy}>
            {busy ? t("cd.saving") : t("cd.save")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}
