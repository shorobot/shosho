import type { Database, Json } from "@shosho/backend/types/database";

export type { Json };
export type Tables = Database["public"]["Tables"];
export type Enums = Database["public"]["Enums"];

export type OrderRow = Tables["orders"]["Row"];
export type OrderItemRow = Tables["order_items"]["Row"];
export type OrderEventRow = Tables["order_events"]["Row"];
export type StaffRow = Tables["staff"]["Row"];
export type CustomerRow = Tables["customers"]["Row"];
export type ZoneRow = Tables["delivery_zones"]["Row"];
export type MenuItemRow = Tables["menu_items"]["Row"];

export type OrderStatus = Enums["order_status"];
export type OrderType = Enums["order_type"];
export type PaymentStatus = Enums["payment_status"];
export type PaymentMethod = Enums["payment_method"];
export type StaffRole = Enums["staff_role"];

/** The board's unit of work: an order with its items and timeline (api-contracts §6.1). */
export type Order = OrderRow & {
  order_items: OrderItemRow[];
  order_events: OrderEventRow[];
};

export type Address = {
  street?: string;
  floor_apt?: string;
  postal_code?: string;
  city?: string;
};

export type OptionSnapshot = { group?: string; option?: string; price_cents?: number };

export type Staff = Pick<StaffRow, "id" | "name" | "role" | "active">;

export type OpsSettings = {
  prep_default_min?: number;
  rush_extra_min?: number;
  preorder_max_days?: number;
  auto_accept_paid_under_cents?: number;
  pause_allowed?: boolean;
  pickup_discount_pct?: number;
};

export type KitchenSettings = {
  paused?: boolean;
  paused_by?: string | null;
  paused_at?: string | null;
  rush?: boolean;
};

export type KitchenStatus = { paused?: boolean; since?: string | null };

export const ORDER_SELECT = "*, order_items(*), order_events(*)" as const;
