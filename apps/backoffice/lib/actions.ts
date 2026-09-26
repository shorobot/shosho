"use client";

import type { PostgrestError } from "@supabase/supabase-js";
import type { Client } from "@/lib/supabase/client";
import type { Json, Order, OrderRow, OrderStatus } from "@/lib/types";

export type ActionPayload = {
  driver_id?: string;
  reason?: string;
  cancel_reason?: string;
  note?: string;
  cash_received?: boolean;
  promised_minutes?: number;
};

export type ActionError = { code: "forbidden" | "transition" | "driver_required" | "not_found" | "other"; message: string };

function mapError(e: PostgrestError): ActionError {
  const m = e.message ?? "";
  if (m.includes("forbidden_for_role") || m.includes("not_staff") || e.code === "42501") return { code: "forbidden", message: m };
  if (m.includes("illegal_transition")) return { code: "transition", message: `${m}${e.details ? ` (${e.details})` : ""}` };
  if (m.includes("driver_required")) return { code: "driver_required", message: m };
  if (m.includes("order_not_found")) return { code: "not_found", message: m };
  return { code: "other", message: m || e.details || e.hint || "unknown" };
}

/**
 * rpc('set_order_status') — returns the updated orders row (api-contracts §2). The caller merges it
 * into the store; items/events arrive through realtime (or an explicit refetch).
 */
export async function setOrderStatus(supabase: Client, order: Order, to: OrderStatus, payload: ActionPayload = {}): Promise<{ row: Order } | { error: ActionError }> {
  const body: Record<string, Json> = { ...payload } as Record<string, Json>;
  // the RPC reads `cancel_reason`; the contract names it `reason` — send both
  if (payload.reason && !payload.cancel_reason) body.cancel_reason = payload.reason;
  const { data, error } = await supabase.rpc("set_order_status", { order_id: order.id, new_status: to, payload: body as Json });
  if (error) return { error: mapError(error) };
  const row = data as unknown as OrderRow;
  return { row: { ...order, ...row, order_items: order.order_items, order_events: order.order_events } };
}

export async function kitchenPause(supabase: Client, paused: boolean): Promise<ActionError | null> {
  const { error } = await supabase.rpc("kitchen_pause", { paused });
  return error ? mapError(error) : null;
}

/** Owner-only: flip settings.kitchen.rush (operator is read-only in v1, §6.1). */
export async function setRush(supabase: Client, current: Record<string, Json>, rush: boolean): Promise<ActionError | null> {
  const { error } = await supabase.from("settings").update({ value: { ...current, rush } }).eq("key", "kitchen");
  return error ? mapError(error) : null;
}
