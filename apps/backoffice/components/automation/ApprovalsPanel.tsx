"use client";

// BO · Automation — the approval screen (boot task 3, api-contracts §8.8b). This is the point of
// the whole step: an `agent_outputs` row arrives `pending` and stays a candidate, never a fact,
// until a human calls `review_agent_output()`.
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Section } from "@/components/menu/Fields";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { agentLabelKey, pendingOutputs, reviewedOutputs, type AgentOutputRow, type ReviewDecision } from "@/lib/automation";
import { useI18n, type Key } from "@/lib/i18n";
import { useAutomation } from "@/lib/automationStore";
import { ddmmHHmm } from "@/lib/time";
import { ReviewDialog } from "@/components/automation/ReviewDialog";
import type { StaffDirectoryRow } from "@/lib/types";

/** What the payload actually is varies per agent/kind (§8.8: "S5's vocabulary, not specified
 * here") — shown as formatted JSON rather than assumed into a shape this screen does not own. */
function payloadPreview(payload: unknown, max = 1600): string {
  const s = JSON.stringify(payload, null, 2) ?? "";
  return s.length > max ? `${s.slice(0, max)}\n…` : s;
}

const STATUS_TONE: Record<AgentOutputRow["status"], "amber" | "ok" | "alert"> = { pending: "amber", approved: "ok", rejected: "alert" };
const STATUS_KEY: Record<AgentOutputRow["status"], Key> = { pending: "auto.output.pending", approved: "auto.output.approved", rejected: "auto.output.rejected" };

export function ApprovalsPanel() {
  const { t } = useI18n();
  const { agents, outputs, staffDirectory, canWrite } = useAutomation();
  const [target, setTarget] = useState<{ output: AgentOutputRow; decision: ReviewDecision } | null>(null);

  const agentKeyById = new Map(agents.map((a) => [a.id, a.key]));
  const agentLabel = (id: string): string => {
    const key = agentKeyById.get(id);
    if (!key) return "—";
    const lk = agentLabelKey(key);
    return lk ? t(lk) : key;
  };
  const staffById = new Map(staffDirectory.map((s: StaffDirectoryRow) => [s.id, s.name]));

  const pending = pendingOutputs(outputs);
  const reviewed = reviewedOutputs(outputs).slice(0, 20);

  return (
    <Section title={t("auto.approvals.title")} hint={t("auto.approvals.hint")}>
      {pending.length === 0 ? (
        <EmptyState icon="✓" title={t("auto.approvals.emptyTitle")} body={t("auto.approvals.emptyBody")} />
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((o) => (
            <div key={o.id} className="flex flex-col gap-2.5 rounded-[16px] bg-field-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-extrabold">{agentLabel(o.agent_id)}</span>
                <Badge tone="muted">{o.kind}</Badge>
                <span className="ml-auto text-[11px] text-muted">{ddmmHHmm(o.created_at)}</span>
              </div>
              <pre className="max-h-[220px] overflow-auto rounded-[12px] bg-paper p-3 text-[11px] leading-[1.5] text-ink-2">{payloadPreview(o.payload)}</pre>
              {canWrite && (
                <div className="flex gap-2">
                  <Pill variant="alert" size="sm" onClick={() => setTarget({ output: o, decision: "rejected" })}>
                    {t("auto.review.reject")}
                  </Pill>
                  <Pill variant="primary" size="sm" onClick={() => setTarget({ output: o, decision: "approved" })}>
                    {t("auto.review.approve")}
                  </Pill>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <span className="label-caps">{t("auto.approvals.recent")}</span>
          {reviewed.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone={STATUS_TONE[o.status]}>{t(STATUS_KEY[o.status])}</Badge>
              <span className="font-medium">{agentLabel(o.agent_id)}</span>
              <span className="text-muted">{o.kind}</span>
              <span className="text-ink-3">{o.reviewer_id ? (staffById.get(o.reviewer_id) ?? "—") : "—"}</span>
              <span className="ml-auto text-ink-3">{o.reviewed_at ? ddmmHHmm(o.reviewed_at) : "—"}</span>
              {o.review_note && <span className="w-full text-[11px] text-muted">{o.review_note}</span>}
            </div>
          ))}
        </div>
      )}

      <ReviewDialog output={target?.output ?? null} decision={target?.decision ?? null} onClose={() => setTarget(null)} />
    </Section>
  );
}
