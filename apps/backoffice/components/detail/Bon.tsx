"use client";

import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { addressOf } from "@/lib/orders";
import { ddmmHHmm } from "@/lib/time";
import type { OptionSnapshot, Order } from "@/lib/types";

/** 80 mm kitchen receipt — only this block is visible in print (see globals.css @media print). */
export function Bon({ order }: { order: Order }) {
  const { t, lang } = useI18n();
  const a = addressOf(order);
  return (
    <div className="bon hidden print:block" aria-hidden>
      <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.35 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>SHOSHO · #{order.number}</div>
        <div>{ddmmHHmm(order.created_at)}</div>
        <div>
          {t(order.type === "pickup" ? "type.pickup" : "type.delivery")}
          {order.scheduled_for ? ` · ${ddmmHHmm(order.scheduled_for)}` : ""} · {t(`channel.${order.channel}` as Key)}
        </div>
        <hr />
        <div>{order.contact_name}</div>
        <div>{order.contact_phone}</div>
        {order.type === "delivery" && (
          <div>
            {a.street} {a.floor_apt ?? ""} · {a.postal_code ?? ""} {a.city ?? ""}
          </div>
        )}
        {order.allergy_note && <div style={{ fontWeight: 800 }}>!! {order.allergy_note}</div>}
        {order.courier_comment && <div>{t("card.comment")}: {order.courier_comment}</div>}
        <hr />
        {order.order_items.map((i) => {
          const opts = (Array.isArray(i.options) ? (i.options as OptionSnapshot[]) : []).filter((o) => o?.option);
          return (
            <div key={i.id} style={{ marginBottom: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  {i.qty}× {i.name}
                </span>
                <span>{euro(i.line_total_cents, lang)}</span>
              </div>
              {opts.length > 0 && <div style={{ paddingLeft: 12 }}>+ {opts.map((o) => o.option).join(", ")}</div>}
            </div>
          );
        })}
        <hr />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14 }}>
          <span>{t("detail.total")}</span>
          <span>{euro(order.total_cents, lang)}</span>
        </div>
        <div>
          {t(`payst.${order.payment_status}` as Key)} · {t(`pay.${order.payment_method}` as Key)}
        </div>
      </div>
    </div>
  );
}
