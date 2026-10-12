// Real data layer: @supabase/supabase-js with the anon key, no auth session (api-contracts §5).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@shosho/backend/types/database";
import { publicEnv } from "./env";
import { PHOTO_BUCKET, SITE_BUCKET, resolveBannerImage, resolvePhotos } from "./photos";
import type { ShoshoApi } from "./api";
import {
  OrderRejectedError,
  type Banner,
  type Catalog,
  type DeliveryZone,
  type ItemOptionGroups,
  type MenuCategory,
  type MenuItem,
  type OrderAttemptPayload,
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
  return { categories: [], items: [], itemOptionGroups: [], zones: [], settings: EMPTY_SETTINGS, banners: [], online };
}

const ITEM_COLUMNS =
  "id, sku, category_id, name_de, name_en, name_ja, transliteration, description_de, description_en, base_price_cents, photos, tags, prep_minutes, allergens, weight_g, kcal_per_100g, sort, recommended_item_ids, max_per_order";

// banners_live's own column list (api-contracts §8.6) — no draft, no active/valid_from/valid_to.
const BANNER_COLUMNS = "id, slot, image_path, title_de, title_en, subtitle_de, subtitle_en, cta_label_de, cta_label_en, cta_href, sort";

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
        const [cats, items, groups, zones, settings, banners] = await Promise.all([
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
          // banners_live (api-contracts §8.6) — the only anon-reachable banner surface; already
          // filtered to active, in-window rows and ordered by slot then sort. Never query `banners`
          // itself: anon's grant on the base table is revoked outright.
          sb.from("banners_live").select(BANNER_COLUMNS).order("slot").order("sort"),
        ]);
        if (cats.error) throw cats.error;
        if (items.error) throw items.error;

        const categories: MenuCategory[] = cats.data ?? [];
        // Bucket paths → public URLs, once, here (lib/photos.ts): every surface downstream receives
        // absolute URLs, so no component needs storage or env access. Synchronous, no network call.
        const publicPhotoUrl = (key: string) => sb.storage.from(PHOTO_BUCKET).getPublicUrl(key).data.publicUrl || null;
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
                  photos: resolvePhotos(r.photos, publicPhotoUrl),
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

        const publicSiteUrl = (key: string) => sb.storage.from(SITE_BUCKET).getPublicUrl(key).data.publicUrl || null;
        const bannerRows: Banner[] = (banners.data ?? []).flatMap((r) =>
          r.id && r.slot
            ? [
                {
                  id: r.id,
                  slot: r.slot,
                  title_de: r.title_de ?? null,
                  title_en: r.title_en ?? null,
                  subtitle_de: r.subtitle_de ?? null,
                  subtitle_en: r.subtitle_en ?? null,
                  cta_label_de: r.cta_label_de ?? null,
                  cta_label_en: r.cta_label_en ?? null,
                  cta_href: r.cta_href ?? null,
                  sort: r.sort ?? 0,
                  image_path: resolveBannerImage(r.image_path, publicSiteUrl),
                },
              ]
            : [],
        );

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
          banners: bannerRows,
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

    async recordOrderAttempt(payload: OrderAttemptPayload): Promise<void> {
      const sb = get();
      if (!sb) return;
      // Funnel telemetry (§1.7): never allowed to affect the guest. A `rate_limited` answer means the
      // limit did its job, so it is logged, not surfaced.
      const { error } = await sb.rpc("record_order_attempt", { payload: payload as never });
      if (error) console.warn("[shosho] order attempt not recorded:", error.message);
    },

    async getOrderByToken(token: string): Promise<TrackedOrder | null> {
      const sb = get();
      if (!sb) throw new ApiError("Backend not configured", "unconfigured");
      const { data, error } = await sb.rpc("get_order_by_token", { token });
      if (error) throw new ApiError(error.message, error.code);
      return (data as unknown as TrackedOrder | null) ?? null;
    },

    subscribeToOrder(token: string, onUpdate: () => void): () => void {
      const sb = get();
      if (!sb) return () => {};
      // api-contracts §3/§5.6: broadcast from the database on the private topic `order:<token>` —
      // the token is the capability, same as get_order_by_token; the anon key authorises the join
      // (realtime evaluates RLS with the subscriber's JWT, which is the anon key here — migration 16
      // grants `anon`/`authenticated` select on `realtime.messages` for topics matching `order:%`).
      // The payload carries no PII, so re-fetching get_order_by_token on every message is enough.
      const channel = sb
        .channel(`order:${token}`, { config: { private: true } })
        .on("broadcast", { event: "order_updated" }, () => onUpdate())
        .subscribe((status) => {
          // Never surface this to the guest (api-contracts §3: "a dropped socket must not freeze
          // the page") — the 15s poll the caller keeps running is the documented fallback, and a
          // CHANNEL_ERROR/TIMED_OUT here is frequently transient (corporate proxy, flaky mobile,
          // the realtime server's own fan-out not being ready for a brand-new topic yet — the race
          // apps/backend/tests/guest_realtime.test.ts task 8 found). The realtime-js client retries
          // with its own stepped backoff and rejoins the channel once the socket reopens; nothing
          // here needs to force that.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[shosho] tracking realtime degraded, relying on the 15s poll:", status);
          }
        });
      return () => {
        void sb.removeChannel(channel);
      };
    },
  };
}
