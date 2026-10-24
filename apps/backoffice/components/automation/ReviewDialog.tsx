"use client";

// BO · Automation — the human decision on one `agent_outputs` row (boot task 3, api-contracts
// §8.8b). Drives `review_agent_output()` only; never writes `status`/`reviewer_id`/`reviewed_at` by
// any other path. `pending` is not offered as a decision — a review cannot be un-made, and the
// function itself rejects it with `invalid_input` if asked.
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import type { AgentOutputRow } from "@/lib/automation";
import type { ReviewDecision } from "@/lib/automation";
import { useI18n } from "@/lib/i18n";
import { useAutomation } from "@/lib/automationStore";
import { toast } from "@/lib/toast";

export function ReviewDialog({ output, decision, onClose }: { output: AgentOutputRow | null; decision: ReviewDecision | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { reviewOutput } = useAutomation();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const open = output != null && decision != null;

  return (
    <Modal open={open} onClose={onClose} title={decision === "approved" ? t("auto.review.approveTitle") : t("auto.review.rejectTitle")}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">{t("auto.review.note")}</span>
          <textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("auto.review.notePlaceholder")} />
        </label>
        <div className="flex gap-2">
          <Pill variant="soft" size="lg" className="flex-1" onClick={onClose}>
            {t("action.close")}
          </Pill>
          <Pill
            variant={decision === "rejected" ? "alert" : "primary"}
            size="lg"
            className="flex-1"
            disabled={busy || !output || !decision}
            onClick={async () => {
              if (!output || !decision) return;
              setBusy(true);
              const err = await reviewOutput(lang, output.id, decision, note.trim() || undefined);
              setBusy(false);
              if (err) {
                if (err.code === "forbidden") toast(t("auto.review.forbidden"));
                else if (err.code === "already_reviewed") toast(t("auto.review.alreadyReviewed"));
                else toast(t("auto.review.error", { m: err.message }));
                return;
              }
              toast(decision === "approved" ? t("auto.review.approved") : t("auto.review.rejected"), "ok");
              setNote("");
              onClose();
            }}
          >
            {decision === "approved" ? t("auto.review.confirmApprove") : t("auto.review.confirmReject")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}
