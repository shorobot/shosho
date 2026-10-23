"use client";

// BO · Automation (api-contracts §8.8/§8.8a/§8.8b, docs/security.md §9, plan.md C4). The place the
// automation layer becomes visible, and where a human decides whether an agent's output counts.
import { useState } from "react";
import { ErrorState, Spinner } from "@/components/ui/States";
import { Pill } from "@/components/ui/Pill";
import { ApprovalsPanel } from "@/components/automation/ApprovalsPanel";
import { QueuePanel } from "@/components/automation/QueuePanel";
import { RegistryPanel } from "@/components/automation/RegistryPanel";
import { RunsPanel } from "@/components/automation/RunsPanel";
import { SpendPanel } from "@/components/automation/SpendPanel";
import { useI18n } from "@/lib/i18n";
import { useAutomation } from "@/lib/automationStore";
import { hhmm } from "@/lib/time";

function ConnectionBanner() {
  const { t } = useI18n();
  const { connection, reconnect } = useAutomation();
  const [dismissed, setDismissed] = useState(false);
  if (connection !== "lost" || dismissed) return null;
  return (
    <ErrorState
      title={t("state.offline.title")}
      body={t("state.offline.body", { t: hhmm(new Date().toISOString()) })}
      actions={
        <>
          <Pill variant="alert" size="sm" onClick={reconnect}>
            {t("state.offline.reconnect")}
          </Pill>
          <Pill variant="soft" size="sm" onClick={() => setDismissed(true)}>
            {t("state.offline.continue")}
          </Pill>
        </>
      }
    />
  );
}

export function AutomationScreen() {
  const { t } = useI18n();
  const { loading, error } = useAutomation();

  return (
    <div className="screen-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] font-extrabold leading-[1.2]">{t("auto.title")}</h1>
        {loading && <Spinner />}
      </div>

      <ConnectionBanner />
      {error && <ErrorState title={t("state.error.title")} body={error} />}

      <ApprovalsPanel />
      <SpendPanel />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <QueuePanel />
        <RunsPanel />
      </div>
      <RegistryPanel />
    </div>
  );
}
