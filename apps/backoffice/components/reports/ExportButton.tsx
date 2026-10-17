"use client";

// XLSX export (S4-05-reports.md). The `exceljs` import is dynamic so the ~1 MB library ships only to
// a viewer who actually clicks export, not on every Berichte page load.
import { useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { useI18n } from "@/lib/i18n";
import { useReports } from "@/lib/reportsStore";
import { toast } from "@/lib/toast";

export function ExportButton() {
  const { t } = useI18n();
  const { range, revenueByDay, topItems, funnel, deliveryTimes, payments, paymentsError } = useReports();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const { exportReportsXlsx } = await import("@/lib/reportsXlsx");
      await exportReportsXlsx({
        range,
        revenueByDay,
        topItems,
        funnel,
        deliveryTimes,
        payments: paymentsError ? null : payments,
        labels: {
          revenue: t("rpt.revenueByDay"),
          topItems: t("rpt.topItems"),
          deliveryTimes: t("rpt.deliveryTimes"),
          payments: t("rpt.payments"),
          funnel: t("rpt.funnel"),
          paymentsForbidden: t("rpt.paymentsForbidden"),
          noDataYet: t("rpt.noPaymentsYet"),
          notCollected: t("rpt.funnelNotCollected"),
          notRecordedYet: t("rpt.funnelNotRecordedYet"),
        },
      });
    } catch (e) {
      toast(t("rpt.exportError", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pill size="sm" variant="ghost" onClick={() => void run()} disabled={busy}>
      {busy ? t("rpt.exporting") : t("rpt.export")}
    </Pill>
  );
}
