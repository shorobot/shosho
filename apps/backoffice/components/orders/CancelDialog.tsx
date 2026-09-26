"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { useT, type Key } from "@/lib/i18n";
import type { Order } from "@/lib/types";

const REASONS: Key[] = ["cancel.reason.customer", "cancel.reason.unreachable", "cancel.reason.soldout", "cancel.reason.outOfZone", "cancel.reason.payment", "cancel.reason.other"];

/** Cancel / reject with a reason — stored in orders.cancel_reason, note goes to the timeline. */
export function CancelDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const t = useT();
  const { run, busy } = useOrderAction();
  const [reason, setReason] = useState<Key>(REASONS[0] as Key);
  const [note, setNote] = useState("");

  return (
    <Modal open={open} onClose={onClose} title={t("cancel.title", { n: order.number })}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">{t("cancel.reason")}</span>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value as Key)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(r)}
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
              const ok = await run(order, "cancelled", { reason: t(reason), note: note.trim() || undefined });
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
