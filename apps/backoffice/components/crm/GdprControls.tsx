"use client";

// "Daten exportieren" and "Daten löschen" (BO · Profil, next to the consents).
//
// Export is real: everything this customer's rows hold, assembled client-side from data already on
// screen (lib/crm.ts `customerExport`), as JSON or CSV. No new endpoint, and nothing the signed-in
// operator could not already read.
//
// Deletion is NOT real, and this is the choice the boot asked to be explicit about. There is no
// server-side single-customer erasure — only the nightly 24-month `anonymise_silent_customers` job
// (§6.8 GDPR note), with S2's `S2-single-customer-erasure.md` proposing one. Of the two options the
// boot allowed, this takes the second: the control **files an auditable request** as a `note` on the
// customer's own timeline for an operator to action by hand.
//
// Why that rather than a disabled button: GDPR Art. 17 starts a clock on the date of the request, so
// the one thing the system must not lose is *that a request was made, by whom, and when*. A disabled
// control records nothing, which means a request arriving by phone lives only in someone's memory.
// Filing a note keeps it in the same timeline the operator already reads, is visible to the next
// person to open the profile, and leaves a row the future RPC can find (`kind: 'erasure_request'`).
// The dialog says in plain words that nothing is deleted yet, so it cannot be mistaken for the act.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { customerExport, customerExportRows, erasureRequestPayload, type Stats } from "@/lib/crm";
import { run, useCrm } from "@/lib/crmStore";
import { downloadText, toCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { Customer, CustomerEventRow, Order } from "@/lib/types";

export function GdprControls({
  customer, stats, events, orders, canWrite, onFiled,
}: {
  customer: Customer;
  stats: Stats;
  events: CustomerEventRow[];
  orders: Order[];
  canWrite: boolean;
  onFiled: () => void | Promise<void>;
}) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { me } = useCrm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const slug = customer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || customer.id;
  const stamp = new Date().toISOString().slice(0, 10);

  function exportJson() {
    const data = customerExport(customer, stats, events, orders);
    downloadText(`shosho-kunde-${slug}-${stamp}.json`, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
  }

  function exportCsv() {
    downloadText(`shosho-kunde-${slug}-${stamp}.csv`, toCsv(customerExportRows(customer, stats, events, orders)));
  }

  async function fileRequest() {
    setBusy(true);
    const payload = erasureRequestPayload(customer, me.name, new Date());
    const ok = await run(lang, () =>
      supabase.rpc("add_customer_event", { customer_id: customer.id, type: "note", payload }),
    );
    setBusy(false);
    if (!ok) return;
    toast(t("cd.erasureFiled"), "ok");
    setOpen(false);
    await onFiled();
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Pill variant="ghost" size="xs" onClick={exportJson}>
          {t("cp.exportJson")}
        </Pill>
        <Pill variant="ghost" size="xs" onClick={exportCsv}>
          {t("cp.exportCsv")}
        </Pill>
        {canWrite && (
          <Pill variant="ghost" size="xs" onClick={() => setOpen(true)}>
            {t("cp.deleteData")}
          </Pill>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t("cd.erasureTitle")}>
        <div className="flex flex-col gap-3.5">
          <span className="text-[13px] leading-[1.55] text-ink-3">{t("cd.erasureBody")}</span>
          <span className="rounded-xl bg-sky-tint p-2.5 text-[11px] leading-[1.5] text-ink-2">{t("cd.erasureLegal")}</span>
          <div className="flex justify-end gap-2">
            <Pill variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("cd.cancel")}
            </Pill>
            <Pill size="sm" onClick={fileRequest} disabled={busy}>
              {busy ? t("cd.saving") : t("cd.erasureConfirm")}
            </Pill>
          </div>
        </div>
      </Modal>
    </>
  );
}
