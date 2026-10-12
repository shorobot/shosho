"use client";

// BO · Einstellungen (api-contracts §6.6 / §6.9; S4-04-settings-cms.md's Einstellungen half +
// S4-05-reports.md). Team → Notifications → Operations → Payments → Legal → Language/Timezone →
// Danger zone, the same order the design canvas lists them in.
import { ErrorState, Spinner } from "@/components/ui/States";
import { DangerZonePanel } from "@/components/settings/DangerZonePanel";
import { LanguageTimezonePanel } from "@/components/settings/LanguageTimezonePanel";
import { LegalPanel } from "@/components/settings/LegalPanel";
import { NotificationsPanel } from "@/components/settings/NotificationsPanel";
import { OperationsPanel } from "@/components/settings/OperationsPanel";
import { PaymentsOverview } from "@/components/settings/PaymentsOverview";
import { TeamPanel } from "@/components/settings/TeamPanel";
import { useI18n } from "@/lib/i18n";
import { useSettings } from "@/lib/settingsStore";

export function SettingsScreen() {
  const { t } = useI18n();
  const { loading, error, canEdit } = useSettings();

  return (
    <div className="screen-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] font-extrabold leading-[1.2]">{t("set.title")}</h1>
        {loading && <Spinner />}
        {!canEdit && !loading && <span className="label-caps rounded-full bg-field px-3 py-1.5 text-muted">{t("set.readOnlyBanner")}</span>}
      </div>

      {error && <ErrorState title={t("state.error.title")} body={error} />}

      <TeamPanel />
      <NotificationsPanel />
      <OperationsPanel />
      <PaymentsOverview />
      <LegalPanel />
      <LanguageTimezonePanel />
      <DangerZonePanel />
    </div>
  );
}
