"use client";

// BO · Berichte (api-contracts §6.10 / §8.5). Period picker, KPI row, then the four
// reports_guard() tables plus report_payments (owner/operator only, shown honestly rather than
// errored) and the funnel with its two stated gaps (D-015 / §6.9 row 5).
import { ErrorState, Spinner } from "@/components/ui/States";
import { DeliveryTimesTable } from "@/components/reports/DeliveryTimesTable";
import { ExportButton } from "@/components/reports/ExportButton";
import { FunnelPanel } from "@/components/reports/FunnelPanel";
import { Kpis } from "@/components/reports/Kpis";
import { PaymentsPanel } from "@/components/reports/PaymentsPanel";
import { PeriodPicker } from "@/components/reports/PeriodPicker";
import { RevenueTable } from "@/components/reports/RevenueTable";
import { TopItemsTable } from "@/components/reports/TopItemsTable";
import { useI18n } from "@/lib/i18n";
import { useReports } from "@/lib/reportsStore";

export function ReportsScreen() {
  const { t } = useI18n();
  const { loading, error, revenueByDay } = useReports();

  return (
    <div className="screen-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] font-extrabold leading-[1.2]">{t("rpt.title")}</h1>
        <div className="ml-auto flex items-center gap-2">
          {loading && <Spinner />}
          <ExportButton />
        </div>
      </div>

      <PeriodPicker />

      {error && <ErrorState title={t("state.error.title")} body={error} />}

      <Kpis />
      <RevenueTable />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TopItemsTable />
        <DeliveryTimesTable />
      </div>
      <PaymentsPanel />
      <FunnelPanel />

      {!loading && revenueByDay.length === 0 && !error && <p className="text-center text-[12px] text-muted">{t("state.noData.cta")}</p>}
    </div>
  );
}
