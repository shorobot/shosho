"use client";

import { useCallback, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { setOrderStatus, type ActionPayload } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { useOrders } from "@/lib/store";
import { toast } from "@/lib/toast";
import type { Order, OrderStatus } from "@/lib/types";

/** Optimistic status change → rpc('set_order_status') → reconcile with the returned row (+ refetch for events). */
export function useOrderAction() {
  const supabase = useSupabase();
  const { applyRow, refetchOrder } = useOrders();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (order: Order, to: OrderStatus, payload: ActionPayload = {}): Promise<boolean> => {
      setBusy(order.id);
      applyRow({ ...order, status: to });
      const res = await setOrderStatus(supabase, order, to, payload);
      if ("error" in res) {
        await refetchOrder(order.id); // revert to the truth
        const e = res.error;
        toast(e.code === "forbidden" ? t("error.forbidden") : e.code === "transition" ? t("error.transition") : e.code === "driver_required" ? t("error.driverRequired") : t("error.action", { m: e.message }));
        setBusy(null);
        return false;
      }
      applyRow(res.row);
      void refetchOrder(order.id); // items + the new timeline event
      setBusy(null);
      return true;
    },
    [supabase, applyRow, refetchOrder, t],
  );

  return { run, busy };
}
