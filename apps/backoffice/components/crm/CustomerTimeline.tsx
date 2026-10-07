"use client";

// BO · Profil → "Verlauf". Orders, complaints, compensations, staff notes, push opens, consent
// changes and anonymisation in one chronological stream — "context before you pick up the phone"
// (canvas note).
//
// The merge itself is in lib/crm.ts (`mergeTimeline`) and tested there: `customer_events` is the
// spine, each `order` event is enriched with the live order row so the status shown is current rather
// than the `new` it was at insert, and an order with no event of its own is synthesised in rather than
// silently missing. This component only renders what that returns.
import Link from "next/link";
import { isErasureRequest, type TimelineEntry } from "@/lib/crm";
import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { ddmm, hhmm } from "@/lib/time";
import type { OrderStatus, StaffDirectoryRow } from "@/lib/types";

// Keyed on the enum, not on `string`, so a status that does not exist fails to compile rather than
// rendering a raw identifier at runtime.
const STATUS_KEY: Record<OrderStatus, Key> = {
  new: "status.new",
  accepted: "status.accepted",
  preparing: "status.preparing",
  ready: "status.ready",
  out_for_delivery: "status.out_for_delivery",
  delivered: "status.delivered",
  picked_up: "status.picked_up",
  cancelled: "status.cancelled",
  refunded: "status.refunded",
};

export function CustomerTimeline({ entries, staff }: { entries: TimelineEntry[]; staff: StaffDirectoryRow[] }) {
  const { t, lang } = useI18n();

  if (entries.length === 0) {
    return <span className="text-[12px] text-muted">{t("cp.activityNone")}</span>;
  }

  return (
    <ol className="flex flex-col gap-2.5">
      {entries.map((e) => {
        const actor =
          e.actor_type === "staff"
            ? (staff.find((s) => s.id === e.actor_id)?.name ?? t("actor.staff"))
            : e.actor_type === "system"
              ? t("actor.system")
              : t("actor.customer");
        return (
          <li key={e.id} className="flex gap-3 text-[12px] leading-[1.45]">
            <span className="w-[76px] flex-none font-extrabold text-muted">
              {ddmm(e.at)}
              <span className="block font-medium">{hhmm(e.at)}</span>
            </span>
            <span className="min-w-0 flex-1 text-ink-2">{line(e, actor)}</span>
          </li>
        );
      })}
    </ol>
  );

  function line(e: TimelineEntry, actor: string) {
    const text = typeof e.payload["text"] === "string" ? e.payload["text"] : "";

    if (e.type === "order") {
      const number = e.order?.number ?? (typeof e.payload["number"] === "number" ? e.payload["number"] : 0);
      const cents = e.order?.total_cents ?? (typeof e.payload["total_cents"] === "number" ? e.payload["total_cents"] : 0);
      const statusKey = e.order ? STATUS_KEY[e.order.status] : undefined;
      const label = statusKey
        ? t("cev.order", { n: number, v: euro(cents, lang), s: t(statusKey) })
        : t("cev.orderPlain", { n: number, v: euro(cents, lang) });
      const orderId = typeof e.payload["order_id"] === "string" ? e.payload["order_id"] : null;
      return orderId ? (
        <Link href={`/orders/${orderId}`} className="underline decoration-line-2 underline-offset-2 transition-micro hover:text-ink">
          {label}
        </Link>
      ) : (
        label
      );
    }

    if (e.type === "note") {
      // An erasure request is a note with a marker, filed because no server-side single-customer
      // erasure exists yet (lib/crm.ts). It reads as what it is rather than as an ordinary note.
      if (isErasureRequest(e)) return <span className="font-extrabold text-alert">{t("cev.erasure", { a: actor })}</span>;
      return e.actor_type === "staff" ? t("cev.note", { a: actor, t: text }) : t("cev.noteSystem", { t: text });
    }

    if (e.type === "complaint") {
      return (
        <span>
          <span className="font-extrabold text-alert">{t("cev.complaint", { t: text })}</span>
          {e.actor_type === "staff" && <span className="text-muted"> {t("cev.by", { a: actor })}</span>}
        </span>
      );
    }

    if (e.type === "compensation") {
      const cents = typeof e.payload["amount_cents"] === "number" ? e.payload["amount_cents"] : null;
      const kind = typeof e.payload["kind"] === "string" ? e.payload["kind"] : "";
      const kindLabel = kind === "voucher" ? t("cd.kindVoucher") : kind === "refund" ? t("cd.kindRefund") : kind === "free_item" ? t("cd.kindFreeItem") : kind;
      const detail = [kindLabel, text].filter(Boolean).join(" · ");
      return (
        <span>
          <span className="font-extrabold">
            {detail ? t("cev.compensation", { v: cents == null ? "" : euro(cents, lang), t: detail }) : t("cev.compensationPlain", { v: cents == null ? "" : euro(cents, lang) })}
          </span>
          {e.actor_type === "staff" && <span className="text-muted"> {t("cev.by", { a: actor })}</span>}
        </span>
      );
    }

    if (e.type === "consent_changed") {
      const channel = typeof e.payload["channel"] === "string" ? e.payload["channel"] : "";
      const channelLabel = channel ? t(`cch.${channel}` as Key) : "";
      const granted = e.payload["granted"] === true;
      const source = typeof e.payload["source"] === "string" ? e.payload["source"] : "—";
      return granted
        ? t("cev.consent_changed_granted", { c: channelLabel, s: source })
        : t("cev.consent_changed_revoked", { c: channelLabel });
    }

    if (e.type === "push_opened") return t("cev.push_opened");
    if (e.type === "anonymised") return t("cev.anonymised");
    return `${e.type} · ${actor}`;
  }
}
