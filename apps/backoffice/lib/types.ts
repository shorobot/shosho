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

/* ---------------------------------------------------------------- menu (api-contracts §1.2 / §6.5) */

export type MenuCategoryRow = Tables["menu_categories"]["Row"];
export type OptionGroupRow = Tables["option_groups"]["Row"];
export type OptionRow = Tables["options"]["Row"];
export type ItemOptionGroupRow = Tables["menu_item_option_groups"]["Row"];

export type MenuCategoryInsert = Tables["menu_categories"]["Insert"];
export type MenuItemInsert = Tables["menu_items"]["Insert"];
export type OptionGroupInsert = Tables["option_groups"]["Insert"];
export type OptionInsert = Tables["options"]["Insert"];

/** An option group with its options, as both the /menu panel and the item editor load it. */
export type OptionGroup = OptionGroupRow & { options: OptionRow[] };

/** A group as it is linked to one item (§1.2 `menu_item_option_groups`). */
export type LinkedGroup = OptionGroup & { link_sort: number };

export const MENU_ITEM_SELECT = "*" as const;
export const OPTION_GROUP_SELECT = "*, options(*)" as const;

/* ------------------------------------------------------------ CRM (api-contracts §1.3 / §6.4 / §6.8) */

export type CustomerAddressRow = Tables["customer_addresses"]["Row"];
export type CustomerEventRow = Tables["customer_events"]["Row"];
export type CustomerStatsRow = Database["public"]["Views"]["customer_stats"]["Row"];
export type StaffDirectoryRow = Database["public"]["Views"]["staff_directory"]["Row"];
export type ActorType = Enums["actor_type"];

/** A customer as the Kunden list and the Profil screen load them (§6.4). */
export type Customer = CustomerRow & { customer_addresses: CustomerAddressRow[] };

export type CustomerUpdate = Tables["customers"]["Update"];

export const CUSTOMER_SELECT = "*, customer_addresses(*)" as const;

/** One consent channel as the Profil screen shows it (§1.3 `consent_email` / `_push` / `_phone`). */
export type ConsentChannel = "email" | "push" | "phone";

/** `{granted_at, source}` or null — the shape stored in each `consent_*` column. */
export type Consent = { granted_at?: string | null; source?: string | null } | null;
