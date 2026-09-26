"use client";

import { useState } from "react";
import { CancelDialog } from "@/components/orders/CancelDialog";
import { ErrorState } from "@/components/ui/States";
import { Pill } from "@/components/ui/Pill";
import { useT } from "@/lib/i18n";
import { useOrders } from "@/lib/store";
import { hhmm } from "@/lib/time";
import type { Order } from "@/lib/types";

/** "Verbindung unterbrochen" from BO · Zustände — realtime dropped; the board still works offline. */
export function ConnectionBanner() {
  const t = useT();
  const { connection, lastUpdate, reconnect } = useOrders();
  const [dismissed, setDismissed] = useState(false);
  if (connection !== "lost" || dismissed) return null;
  return (
    <ErrorState
      title={t("state.offline.title")}
      body={t("state.offline.body", { t: lastUpdate ? hhmm(lastUpdate.toISOString()) : "—" })}
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

/** payment_status = failed → the design's "Zahlung fehlgeschlagen" card with its three actions. */
export function PaymentFailedBanner({ order }: { order: Order }) {
  const t = useT();
  const [cancel, setCancel] = useState(false);
  return (
    <>
      <ErrorState
        title={`${t("state.payFailed.title")} · #${order.number}`}
        body={t("state.payFailed.body", { n: order.contact_name })}
        actions={
          <>
            <a href={`tel:${order.contact_phone.replace(/\s+/g, "")}`} className="rounded-full bg-alert px-4 py-2.5 text-[12px] font-extrabold text-white">
              {t("state.payFailed.call")}
            </a>
            <Pill variant="soft" size="sm" onClick={() => setCancel(true)}>
              {t("state.payFailed.cancel")}
            </Pill>
          </>
        }
      />
      <CancelDialog order={order} open={cancel} onClose={() => setCancel(false)} />
    </>
  );
}
