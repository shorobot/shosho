// Real data layer: @supabase/supabase-js with the anon key, no auth session (api-contracts §5).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@shosho/backend/types/database";
import { publicEnv } from "./env";
import type { ShoshoApi } from "./api";
import {
  OrderRejectedError,
  type Catalog,
  type DeliveryZone,
  type ItemOptionGroups,
  type MenuCategory,
  type MenuItem,
  type PlaceOrderPayload,
  type PlaceOrderResult,
  type Problem,
  type PublicSettings,
  type Quote,
  type QuotePayload,
  type TrackedOrder,
} from "./types";

type Client = SupabaseClient<Database>;

const EMPTY_SETTINGS: PublicSettings = { business: null, opening_hours: null, site: null, payments_enabled: null, kitchen_status: null };

export function emptyCatalog(online = false): Catalog {
  return { categories: [], items: [], itemOptionGroups: [], zones: [], settings: EMPTY_SETTINGS, online };
}

const ITEM_COLUMNS =
  "id, sku, category_id, name_de, name_en, name_ja, transliteration, description_de, description_en, base_price_cents, photos, tags, prep_minutes, allergens, weight_g, kcal_per_100g, sort, recommended_item_ids, max_per_order";

function makeClient(): Client | null {
  const env = publicEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  const isServer = typeof window === "undefined";
  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: isServer
      ? {
          // Server components: let Next cache menu reads for a minute (menu edits show up within 60 s).
          fetch: (input, init) => fetch(input, { ...init, next: { revalidate: 60 } } as RequestInit),
        }
      : undefined,
  });
}

export class ApiError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

function parseProblems(details: unknown): Problem[] {
  if (Array.isArray(details)) return details as Problem[];
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details);
      return Array.isArray(parsed) ? (parsed as Problem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function createSupabaseApi(): ShoshoApi {
  let client: Client | null | undefined;
  const get = () => {
    if (client === undefined) client = makeClient();
    return client;
  };

  return {
    async getCatalog(): Promise<Catalog> {
      const sb = get();
      if (!sb) return emptyCatalog(false);
      try {
        const [cats, items, groups, zones, settings] = await Promise.all([
          sb.from("menu_categories").select("id, slug, name_de, name_en, name_ja, sort, schedule").order("sort"),
          sb.from("menu_items_on_sale").select(ITEM_COLUMNS).order("sort"),
          sb
            .from("menu_item_option_groups")
            .select(
              "item_id, group_id, sort, option_groups(id, name_de, name_en, min_select, max_select, required, options(id, name_de, name_en, price_cents, sort, active))",
            )
            .order("sort"),
          sb
            .from("delivery_zones")
            .select("code, name, areas, min_order_cents, fee_cents, free_delivery_over_cents, promised_minutes, postal_codes")
            .order("code"),
          sb.from("settings").select("key, value").in("key", ["business", "opening_hours", "site", "payments.enabled", "kitchen.status"]),
        ]);
        if (cats.error) throw cats.error;
        if (items.error) throw items.error;

        const categories: MenuCategory[] = cats.data ?? [];
        // The view types every column as nullable; on-sale rows always carry these.
        const menuItems: MenuItem[] = (items.data ?? []).flatMap((r) =>
          r.id && r.sku && r.category_id && r.name_en && r.name_de && r.base_price_cents != null
            ? [
                {
                  id: r.id,
                  sku: r.sku,
                  category_id: r.category_id,
                  name_de: r.name_de,
                  name_en: r.name_en,
                  name_ja: r.name_ja ?? null,
                  transliteration: r.transliteration ?? null,
                  description_de: r.description_de ?? null,
                  description_en: r.description_en ?? null,
                  base_price_cents: r.base_price_cents,
                  photos: r.photos ?? [],
                  tags: r.tags ?? [],
                  prep_minutes: r.prep_minutes ?? null,
                  allergens: r.allergens ?? [],
                  weight_g: r.weight_g ?? null,
                  kcal_per_100g: r.kcal_per_100g ?? null,
                  sort: r.sort ?? 0,
                  recommended_item_ids: r.recommended_item_ids ?? [],
                  max_per_order: r.max_per_order ?? null,
                },
              ]
            : [],
        );

        const byItem = new Map<string, ItemOptionGroups>();
        for (const row of groups.data ?? []) {
          const g = row.option_groups;
          if (!g) continue;
          const entry = byItem.get(row.item_id) ?? { item_id: row.item_id, groups: [] };
          entry.groups.push({
            id: g.id,
            name_de: g.name_de,
            name_en: g.name_en,
            min_select: g.min_select,
            max_select: g.max_select,
            required: g.required,
            options: (g.options ?? [])
              .filter((o) => o.active)
              .sort((a, b) => a.sort - b.sort)
              .map((o) => ({ id: o.id, name_de: o.name_de, name_en: o.name_en, price_cents: o.price_cents, sort: o.sort })),
          });
          byItem.set(row.item_id, entry);
        }

        const settingRows = new Map<string, unknown>();
        for (const s of settings.data ?? []) settingRows.set(s.key, s.value);
        const pick = <T,>(k: string): T | null => (settingRows.get(k) as T | undefined) ?? null;

        return {
          categories,
          items: menuItems,
          itemOptionGroups: [...byItem.values()],
          zones: (zones.data ?? []) as DeliveryZone[],
          settings: {
            business: pick("business"),
            opening_hours: pick("opening_hours"),
            site: pick("site"),
            payments_enabled: pick("payments.enabled"),
            kitchen_status: pick("kitchen.status"),
          },
          online: true,
        };
      } catch (e) {
        console.error("[shosho] catalog unavailable:", e instanceof Error ? e.message : e);
        return emptyCatalog(false);
      }
    },

    async quoteOrder(payload: QuotePayload): Promise<Quote> {
      const sb = get();
      if (!sb) throw new ApiError("Backend not configured", "unconfigured");
      const { data, error } = await sb.rpc("quote_order", { payload: payload as never });
      if (error) throw new ApiError(error.message, error.code);
      return data as unknown as Quote;
    },

    async placeOrder(payload: PlaceOrderPayload): Promise<PlaceOrderResult> {
      const sb = get();
      if (!sb) throw new ApiError("Backend not configured", "unconfigured");
      const { data, error } = await sb.rpc("place_order", { payload: payload as never });
      if (error) {
        if (error.message === "order_rejected") throw new OrderRejectedError(parseProblems(error.details));
        throw new ApiError(error.message, error.code);
      }
      return data as unknown as PlaceOrderResult;
    },

    async getOrderByToken(token: string): Promise<TrackedOrder | null> {
      const sb = get();
      if (!sb) throw new ApiError("Backend not configured", "unconfigured");
      const { data, error } = await sb.rpc("get_order_by_token", { token });
      if (error) throw new ApiError(error.message, error.code);
      return (data as unknown as TrackedOrder | null) ?? null;
    },
  };
}
