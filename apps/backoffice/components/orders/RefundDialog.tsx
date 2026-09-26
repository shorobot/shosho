"use client";

import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { useI18n } from "@/lib/i18n";
import { euro } from "@/lib/money";
import type { Order } from "@/lib/types";

/** delivered|picked_up + paid → refunded. The real payout runs through the provider (D-011, S2-02). */
export function RefundDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { run, busy } = useOrderAction();
  return (
    <Modal open={open} onClose={onClose} title={t("refund.title", { n: order.number })}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-[1.55] text-ink-3">{t("refund.body", { v: euro(order.total_cents, lang) })}</p>
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
              const ok = await run(order, "refunded");
              if (ok) onClose();
            }}
          >
            {t("refund.confirm")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}
