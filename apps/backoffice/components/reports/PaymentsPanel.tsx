"use client";

// report_payments (§8.5) — owner/operator only, narrower than the other four reports_guard() RPCs by
// design. Two honest states beyond "has rows": `forbidden` (this screen is already owner/operator
// only, so this should never actually fire — defensive) and "no payment data yet" when every row
// reads zero, because no live payment has ever run on this project. Never shown as €0,00 — a zero
// there reads as "no sales", a different and alarming claim.
import { Section } from "@/components/menu/Fields";
import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { payMethodKey, payStatusKey } from "@/lib/labels";
import { paymentsView } from "@/lib/reports";
import { useReports } from "@/lib/reportsStore";

export function PaymentsPanel() {
  const { t, lang } = useI18n();
  const { payments, paymentsError } = useReports();
  const view = paymentsView(payments, paymentsError);

  if (!view.ok) {
    return (
      <Section title={t("rpt.payments")}>
        <p className="text-[12px] leading-[1.55] text-muted">{t("rpt.paymentsForbidden")}</p>
      </Section>
    );
  }

  if (view.allZero) {
    return (
      <Section title={t("rpt.payments")}>
        <p className="text-[12px] leading-[1.55] text-muted">{t("rpt.noPaymentsYet")}</p>
      </Section>
    );
  }

  return (
    <Section title={t("rpt.payments")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line-2 text-left">
              {(["rpt.th.method", "rpt.th.status", "rpt.th.orders", "rpt.th.revenue", "rpt.th.failedJobs"] as Key[]).map((k) => (
                <th key={k} className="label-caps px-3 py-2.5 font-medium">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={`${r.payment_method}-${r.payment_status}`} className="border-b border-line last:border-0 hover:bg-field-2">
                <td className="px-3 py-2.5 font-medium">{t(payMethodKey(r.payment_method))}</td>
                <td className="px-3 py-2.5 text-ink-3">{t(payStatusKey(r.payment_status))}</td>
                <td className="px-3 py-2.5">{r.orders_count}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-extrabold">
                  {euro(r.total_cents, lang)}
                  {r.refunded_cents > 0 && <span className="ml-1.5 font-medium text-muted">(−{euro(r.refunded_cents, lang)})</span>}
                </td>
                <td className="px-3 py-2.5 text-ink-3">{r.failed_jobs_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
