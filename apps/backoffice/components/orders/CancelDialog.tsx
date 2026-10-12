"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { useT } from "@/lib/i18n";
import { CANCEL_REASON_CODES, CANCEL_REASON_KEY, type CancelReasonCode } from "@/lib/orders";
import type { Order } from "@/lib/types";

/** Cancel / reject with a reason — a stable code in orders.cancel_reason, translated at render (lib/orders.ts's cancelReasonLabel); note goes to the timeline. */
export function CancelDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const t = useT();
  const { run, busy } = useOrderAction();
  const [reason, setReason] = useState<CancelReasonCode>(CANCEL_REASON_CODES[0]);
  const [note, setNote] = useState("");

  return (
    <Modal open={open} onClose={onClose} title={t("cancel.title", { n: order.number })}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">{t("cancel.reason")}</span>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value as CancelReasonCode)}>
            {CANCEL_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {t(CANCEL_REASON_KEY[code])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">{t("cancel.note")}</span>
          <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <Pill variant="soft" size="lg" className="flex-1" onClick={onClose}>
            {t("action.close")}
          </Pill>
          <Pill
            variant="alert"
            size="lg"
            className="flex-1"
            disabled={busy === order.id}
            onClick={async () => {
              const ok = await run(order, "cancelled", { reason, note: note.trim() || undefined });
              if (ok) onClose();
            }}
          >
            {t("cancel.confirm")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}
