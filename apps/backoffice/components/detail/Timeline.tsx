"use client";

import { useI18n, type Key } from "@/lib/i18n";
import { useOrders } from "@/lib/store";
import { hhmm } from "@/lib/time";
import type { OrderEventRow } from "@/lib/types";

const EVENT_KEY: Record<string, Key> = {
  created: "event.created",
  payment_authorized: "event.payment_authorized",
  accepted: "event.accepted",
  preparing: "event.preparing",
  item_changed: "event.item_changed",
  ready: "event.ready",
  handed_to_driver: "event.handed_to_driver",
  delivered: "event.delivered",
  picked_up: "event.picked_up",
  cancelled: "event.cancelled",
  refunded: "event.refunded",
  note: "event.note",
  kitchen_paused: "event.kitchen_paused",
  kitchen_resumed: "event.kitchen_resumed",
};

/** "Verlauf" — order_events with the actor's name resolved through `staff` (api-contracts §6.2). */
export function Timeline({ events }: { events: OrderEventRow[] }) {
  const { t } = useI18n();
  const { staff } = useOrders();
  const rows = [...events].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="flex flex-col gap-2.5">
      <span className="label-caps">{t("detail.activity")}</span>
      <ol className="flex flex-col gap-2">
        {rows.map((e) => {
          const payload = (e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? e.payload : {}) as Record<string, unknown>;
          const actor = e.actor_type === "staff" ? staff.find((s) => s.id === e.actor_id)?.name ?? t("actor.staff") : e.actor_type === "system" ? t("actor.system") : t("actor.customer");
          const key = EVENT_KEY[e.type];
          const driverName = staff.find((s) => s.id === payload["driver_id"])?.name ?? "";
          const text = key
            ? t(key, {
                a: actor,
                c: typeof payload["channel"] === "string" ? t(`channel.${payload["channel"]}` as Key) : t("channel.website"),
                r: typeof payload["payment_ref"] === "string" ? payload["payment_ref"] : typeof payload["payment_method"] === "string" ? t(`pay.${payload["payment_method"]}` as Key) : "",
                d: driverName,
                t: typeof payload["text"] === "string" ? payload["text"] : "",
              })
            : `${e.type} · ${actor}`;
          return (
            <li key={e.id} className="flex gap-3 text-[12px] leading-[1.45]">
              <span className="w-[42px] flex-none font-extrabold text-muted">{hhmm(e.at)}</span>
              <span className="min-w-0 flex-1 text-ink-2">
                {text}
                {e.type === "cancelled" && typeof payload["reason"] === "string" && payload["reason"] ? ` · ${payload["reason"]}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
