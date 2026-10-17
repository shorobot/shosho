"use client";

import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { useI18n } from "@/lib/i18n";
import { euro } from "@/lib/money";
import type { Order, OrderStatus } from "@/lib/types";

/**
 * Completing a cash order: ask whether the money is in hand and send the answer explicitly
 * (api-contracts §6.8 — `set_order_status(…, { cash_received })`).
 *
 * Both buttons complete the order; they differ only in the payload. That is the point — the server
 * reads `coalesce((payload->>'cash_received')::boolean, false)`, so a missing answer is silently
 * recorded as "not received" and a collected order stays `pending` forever (S6-01 finding 2). There
 * is deliberately **no** default and no pre-selected button: "not received" is a real, legitimate
 * outcome (the customer refused, or was short), and it writes its own `cash_not_received` note for
 * the operator to chase.
 */
export function CashDialog({ order, to, open, onClose }: { order: Order; to: OrderStatus; open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { run, busy } = useOrderAction();

  async function settle(cash_received: boolean) {
    const ok = await run(order, to, { cash_received });
    if (ok) onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={t("cash.title", { n: order.number })}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-[1.55] text-ink-3">{t("cash.body", { v: euro(order.total_cents, lang) })}</p>
        <p className="rounded-xl bg-field px-3 py-2 text-[11px] leading-[1.45] text-muted">{t("cash.hint")}</p>
        <div className="flex gap-2">
          <Pill variant="soft" size="lg" className="flex-1" disabled={busy === order.id} onClick={() => void settle(false)}>
            {t("cash.notReceived")}
          </Pill>
          <Pill variant="primary" size="lg" className="flex-1" disabled={busy === order.id} onClick={() => void settle(true)}>
            {t("cash.received")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}
