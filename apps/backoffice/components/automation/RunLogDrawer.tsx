"use client";

// BO · Automation — one run's ordered log lines (boot task 2). Loaded and subscribed only while
// open: `useRunLogs` unsubscribes on unmount (close), exactly what the boot asks to be proven.
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/States";
import { useRunLogs } from "@/lib/automationStore";
import { useI18n } from "@/lib/i18n";
import { ddmmHHmm } from "@/lib/time";
import type { AgentRunLogRow } from "@/lib/automation";

const LEVEL_TONE: Record<string, string> = {
  error: "text-alert",
  warn: "text-orange-ink",
  info: "text-ink-2",
};

export function RunLogDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const { logs, loading } = useRunLogs(runId);
  return (
    <Modal open={runId != null} onClose={onClose} title={t("auto.logs.title")} wide>
      {loading ? (
        <Spinner label={t("auto.logs.loading")} />
      ) : logs.length === 0 ? (
        <p className="text-[12px] text-muted">{t("auto.logs.empty")}</p>
      ) : (
        <div className="max-h-[60dvh] overflow-y-auto rounded-[14px] bg-field-2 p-3.5">
          <ul className="flex flex-col gap-1.5 font-mono text-[11px] leading-[1.5]">
            {logs.map((l: AgentRunLogRow) => (
              <li key={l.id} className="flex gap-2">
                <span className="flex-none text-ink-3">{ddmmHHmm(l.at)}</span>
                <span className={`flex-none font-extrabold uppercase ${LEVEL_TONE[l.level] ?? "text-ink-2"}`}>{l.level}</span>
                <span className="whitespace-pre-wrap break-all">{l.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
