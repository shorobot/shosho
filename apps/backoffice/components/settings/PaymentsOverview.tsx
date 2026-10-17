"use client";

// Read-only view of settings.payments / settings['payments.enabled'] — configured via D-011, not
// edited here (S4-05-reports.md: "payments (read-only view of what D-011 configures)").
import { ReadOnlySection } from "@/components/settings/SettingsSection";
import { useI18n } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { parsePayments, parsePaymentsEnabled } from "@/lib/settings";
import { useSettings } from "@/lib/settingsStore";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 text-[12px] last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-extrabold">{value}</span>
    </div>
  );
}

export function PaymentsOverview() {
  const { t, lang } = useI18n();
  const { settingsByKey } = useSettings();
  const payments = parsePayments(settingsByKey.get("payments")?.value ?? {});
  const enabled = parsePaymentsEnabled(settingsByKey.get("payments.enabled")?.value ?? {});
  const yesNo = (v: boolean | undefined) => (v ? t("set.yes") : t("set.no"));

  return (
    <ReadOnlySection title={t("set.payments")} hint={t("set.paymentsHint")}>
      <Row label={t("set.paymentsProvider")} value={payments.provider ?? "—"} />
      <Row label={t("set.paymentsCash")} value={yesNo(payments.cash_on_delivery)} />
      <Row label={t("set.paymentsMethods")} value={enabled.methods?.join(", ") ?? "—"} />
      <Row label={t("set.paymentsCapture")} value={enabled.capture ?? "—"} />
      <Row label={t("set.paymentsTipPresets")} value={enabled.tip_presets_cents?.map((c) => euro(c, lang)).join(" · ") ?? "—"} />
    </ReadOnlySection>
  );
}
