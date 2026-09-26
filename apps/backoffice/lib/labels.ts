import type { Key, Lang } from "@/lib/i18n";
import type { Order, OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/types";
import type { Tone } from "@/components/ui/Badge";
import type { Urgency } from "@/lib/orders";

export function statusTone(s: OrderStatus, urgency: Urgency): Tone {
  if (urgency === "critical") return "alert";
  switch (s) {
    case "new":
      return "orange";
    case "accepted":
      return "blue";
    case "preparing":
      return urgency === "warn" ? "amber" : "blue";
    case "ready":
      return "ok";
    case "out_for_delivery":
      return "ok";
    case "cancelled":
    case "refunded":
      return "muted";
    default:
      return "ink";
  }
}

/** Left border colour of a board card. */
export function cardEdge(s: OrderStatus, urgency: Urgency): string {
  if (urgency === "critical") return "border-alert shadow-(--shadow-alert) outline outline-[1.5px] outline-alert";
  if (urgency === "warn") return "border-amber";
  switch (s) {
    case "new":
      return "border-orange";
    case "accepted":
    case "preparing":
      return "border-blue";
    case "ready":
    case "out_for_delivery":
      return "border-ok";
    default:
      return "border-done";
  }
}

export function payMethodKey(m: PaymentMethod): Key {
  return `pay.${m}` as Key;
}

export function payStatusKey(s: PaymentStatus): Key {
  return `payst.${s}` as Key;
}

export function statusKey(s: OrderStatus): Key {
  return `status.${s}` as Key;
}

export function statusLongKey(s: OrderStatus): Key {
  return `statusLong.${s}` as Key;
}

export function itemName(name: string): string {
  return name;
}

/** Name of a menu item for the given language, given the DE/EN columns. */
export function pickName(lang: Lang, de: string | null | undefined, en: string | null | undefined): string {
  return (lang === "de" ? de || en : en || de) ?? "";
}

export function isCashUnpaid(o: Pick<Order, "payment_method" | "payment_status">): boolean {
  return o.payment_method === "cash" && (o.payment_status === "pending" || o.payment_status === "authorized");
}
