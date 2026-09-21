// Copy for quote / place_order problems (api-contracts §5.2). Every state names the reason and
// offers the next action — the Zustände screen is the reference.
import { euro } from "./money";
import type { Problem } from "./types";

export function promoReason(reason: string | undefined): string {
  switch (reason) {
    case "unknown": return "We don't know this code.";
    case "expired": return "This code has expired.";
    case "not_yet_valid": return "This code is not valid yet.";
    case "limit_reached": return "This code has been used up.";
    case "min_order": return "Your order is below the minimum for this code.";
    case "wrong_day": return "This code is not valid today.";
    case "too_late": return "This code is only valid earlier in the day.";
    case "category_not_in_cart": return "This code needs an item from a specific category.";
    case "not_first_order": return "This code is for first orders only.";
    default: return "This code can't be applied.";
  }
}

export function unavailableReason(p: Problem): string {
  switch (p.reason) {
    case "schedule": return "Not available at this time of day.";
    case "max_per_order": return `Maximum ${p.max ?? ""} per order.`;
    case "stock": return p.remaining ? `Only ${p.remaining} left today.` : "Sold out for today.";
    default: return "Sold out for today.";
  }
}

export function closedReason(reason: string | undefined): { title: string; body: string } {
  switch (reason) {
    case "kitchen_paused":
      return { title: "Sold out today", body: "The kitchen has paused new orders for now. Pre-orders for later are still possible." };
    case "slot_too_soon":
      return { title: "That slot is too soon", body: "Pick a time at least 15 minutes from now." };
    case "slot_too_far":
      return { title: "That slot is too far ahead", body: "We take pre-orders up to 7 days ahead." };
    case "slot_outside_hours":
      return { title: "We're closed at that time", body: "Pick a slot inside our opening hours." };
    case "outside_hours":
    default:
      return { title: "We're closed right now", body: "Pre-orders only — pick a time and we'll have it ready." };
  }
}

export function fieldLabel(field: string | undefined): string {
  switch (field) {
    case "contact.name": return "your name";
    case "contact.phone": return "a valid phone number";
    case "address": return "street and postal code";
    case "payment_method": return "a payment method";
    case "type": return "delivery or pickup";
    default: return field ?? "input";
  }
}

/** One-line summary for problems that are not shown inline elsewhere. */
export function problemSummary(p: Problem): string {
  switch (p.code) {
    case "empty_cart": return "Your basket is empty.";
    case "below_min_order": return `Minimum order for your zone is ${euro(p.min_order_cents)} — you're at ${euro(p.subtotal_cents)}.`;
    case "out_of_zone": return p.reason === "postal_code_missing" ? "Enter your postal code to see delivery options." : `We don't deliver to ${p.postal_code ?? "this address"}.`;
    case "closed": return closedReason(p.reason).title;
    case "promo_invalid": return promoReason(p.reason);
    case "unavailable": return unavailableReason(p);
    case "invalid_options": return "Please review the options for this item.";
    case "invalid_input": return `Please add ${fieldLabel(p.field)}.`;
    default: return "Something needs your attention.";
  }
}

export const has = (problems: Problem[] | undefined, code: Problem["code"]) => (problems ?? []).some((p) => p.code === code);
export const find = (problems: Problem[] | undefined, code: Problem["code"]) => (problems ?? []).find((p) => p.code === code);
