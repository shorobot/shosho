// Domain types for the guest site — derived from apps/backend/types/database.ts (api-contracts §5).
// Money is integer cents, times are ISO strings; the DB reasons in Europe/Berlin.
import type { Database, Json } from "@shosho/backend/types/database";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type OrderType = Enums["order_type"];
export type OrderStatus = Enums["order_status"];
export type PaymentMethod = Enums["payment_method"];
export type PaymentStatus = Enums["payment_status"];

export type MenuCategory = Pick<
  Tables["menu_categories"]["Row"],
  "id" | "slug" | "name_de" | "name_en" | "name_ja" | "sort" | "schedule"
>;

/** On-sale item (view `menu_items_on_sale`, RLS-filtered for anon). */
export type MenuItem = Pick<
  Tables["menu_items"]["Row"],
  | "id"
  | "sku"
  | "category_id"
  | "name_de"
  | "name_en"
  | "name_ja"
  | "transliteration"
  | "description_de"
  | "description_en"
  | "base_price_cents"
  | "photos"
  | "tags"
  | "prep_minutes"
  | "allergens"
  | "weight_g"
  | "kcal_per_100g"
  | "sort"
  | "recommended_item_ids"
  | "max_per_order"
>;

export type MenuOption = Pick<Tables["options"]["Row"], "id" | "name_de" | "name_en" | "price_cents" | "sort">;

export type OptionGroup = Pick<
  Tables["option_groups"]["Row"],
  "id" | "name_de" | "name_en" | "min_select" | "max_select" | "required"
> & { options: MenuOption[] };

/** Option groups of one item, in `menu_item_option_groups.sort` order. */
export type ItemOptionGroups = { item_id: string; groups: OptionGroup[] };

export type DeliveryZone = Pick<
  Tables["delivery_zones"]["Row"],
  | "code"
  | "name"
  | "areas"
  | "min_order_cents"
  | "fee_cents"
  | "free_delivery_over_cents"
  | "promised_minutes"
  | "postal_codes"
>;

export type OpeningHours = {
  mon?: [string, string][];
  tue?: [string, string][];
  wed?: [string, string][];
  thu?: [string, string][];
  fri?: [string, string][];
  sat?: [string, string][];
  sun?: [string, string][];
  holidays?: string[];
};

export type BusinessSettings = {
  name?: string;
  address?: { street?: string; postal_code?: string; city?: string; country?: string };
  phone?: string;
  email?: string;
  impressum?: string;
  ust_id?: string;
};

export type SiteSettings = {
  seo?: { title?: string; description?: string };
  cookie_banner?: boolean;
  robots?: string;
  maintenance?: boolean;
  free_delivery_hint_cents?: number;
};

export type PaymentsEnabled = {
  methods?: PaymentMethod[];
  tip_presets_cents?: number[];
  capture?: string;
};

export type KitchenStatus = { paused?: boolean; since?: string | null };

/** The five public `settings` keys (api-contracts §5.1). Every key may be missing on an empty project. */
export type PublicSettings = {
  business: BusinessSettings | null;
  opening_hours: OpeningHours | null;
  site: SiteSettings | null;
  payments_enabled: PaymentsEnabled | null;
  kitchen_status: KitchenStatus | null;
};

/** Everything the storefront needs to render — one server round-trip, cached. */
export type Catalog = {
  categories: MenuCategory[];
  items: MenuItem[];
  itemOptionGroups: ItemOptionGroups[];
  zones: DeliveryZone[];
  settings: PublicSettings;
  /** true when the data layer answered; false = unconfigured / unreachable → render empty states. */
  online: boolean;
};

// ---- quote_order / place_order (api-contracts §5.2, §5.3)

export type QuoteItem = { item_id: string; qty: number; option_ids?: string[] };

export type QuotePayload = {
  type: OrderType;
  items: QuoteItem[];
  postal_code?: string;
  promo_code?: string;
  scheduled_for?: string | null;
  tip_cents?: number;
  contact?: { phone?: string };
};

export type ProblemCode =
  | "unavailable"
  | "invalid_options"
  | "below_min_order"
  | "out_of_zone"
  | "closed"
  | "promo_invalid"
  | "empty_cart"
  | "invalid_input";

export type Problem = {
  code: ProblemCode;
  item_id?: string;
  option_id?: string;
  group_id?: string;
  reason?: string;
  field?: string;
  postal_code?: string;
  min_order_cents?: number;
  subtotal_cents?: number;
  max?: number | null;
  min?: number;
  selected?: number;
  remaining?: number;
  promo_code?: string;
};

export type QuoteLineOption = {
  group_id: string;
  group: string;
  group_de: string;
  option_id: string;
  option: string;
  option_de: string;
  price_cents: number;
};

export type QuoteLine = {
  item_id: string;
  sku: string;
  category_id: string;
  name: string;
  name_de: string;
  name_en: string;
  name_ja: string | null;
  qty: number;
  unit_price_cents: number;
  options: QuoteLineOption[];
  options_cents: number;
  line_total_cents: number;
  prep_minutes: number | null;
  allergens: string[];
};

export type QuoteZone = {
  id: string;
  code: string;
  name: string;
  min_order_cents: number;
  fee_cents: number;
  free_delivery_over_cents: number | null;
  promised_minutes: number;
};

export type Quote = {
  ok: boolean;
  type: OrderType;
  scheduled_for: string | null;
  lines: QuoteLine[];
  subtotal_cents: number;
  pickup_discount_cents: number;
  promo_discount_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  tip_cents: number;
  total_cents: number;
  vat_cents: number;
  zone: QuoteZone | null;
  promised_minutes: number | null;
  promo: { code: string; kind: "percent" | "fixed"; value: number; discount_cents: number; scope: string } | null;
  problems: Problem[];
};

export type CommentFlag = "leave_at_door" | "dont_ring" | "call_on_arrival" | "no_wasabi";

export type PlaceOrderPayload = QuotePayload & {
  contact: { name: string; phone: string; email?: string };
  address?: { street: string; floor_apt?: string; postal_code: string; city?: string };
  courier_comment?: string;
  comment_flags?: CommentFlag[];
  payment_method: PaymentMethod;
  payment_status?: "pending" | "authorized";
  payment_ref?: string;
  tip_cents?: number;
};

export type PlaceOrderResult = {
  order_id: string;
  number: number;
  total_cents: number;
  tracking_token: string;
  status: "new" | "accepted";
};

/** Thrown by `placeOrder` when the server answers `order_rejected` — carries the parsed problems. */
export class OrderRejectedError extends Error {
  problems: Problem[];
  constructor(problems: Problem[]) {
    super("order_rejected");
    this.name = "OrderRejectedError";
    this.problems = problems;
  }
}

export type TrackedOrderItem = {
  name: string;
  qty: number;
  unit_price_cents: number;
  options: QuoteLineOption[] | Json;
  line_total_cents: number;
};

export type TrackedOrder = {
  order_id: string;
  number: number;
  status: OrderStatus;
  type: OrderType;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  scheduled_for: string | null;
  promised_minutes: number | null;
  eta: string | null;
  created_at: string;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  out_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  contact_name: string;
  address: { street?: string; floor_apt?: string; postal_code?: string; city?: string } | null;
  courier_comment: string | null;
  comment_flags: CommentFlag[] | null;
  items: TrackedOrderItem[];
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  tip_cents: number;
  total_cents: number;
  vat_cents: number;
  promo_code: string | null;
  events: { at: string; type: string }[];
};
