// In-memory copy of apps/backend/supabase/seed.sql — used by lib/api-mock.ts (NEXT_PUBLIC_API=mock)
// and by the unit tests. Same UUIDs as the seed so links and fixtures line up.
import type { DeliveryZone, ItemOptionGroups, MenuCategory, MenuItem, OptionGroup, PublicSettings } from "./types";

const cat = (n: string) => `20000000-0000-4000-8000-0000000000${n}`;
const item = (n: string) => `30000000-0000-4000-8000-0000000000${n}`;
const grp = (n: string) => `40000000-0000-4000-8000-0000000000${n}`;
const opt = (n: string) => `41000000-0000-4000-8000-000000000${n}`;

export const MOCK_CATEGORIES: MenuCategory[] = [
  { id: cat("01"), slug: "sets", name_de: "Sets", name_en: "Sets", name_ja: "セット", sort: 10, schedule: null },
  { id: cat("02"), slug: "sushi", name_de: "Sushi", name_en: "Sushi", name_ja: "寿司", sort: 20, schedule: null },
  { id: cat("03"), slug: "rolls", name_de: "Rolls", name_en: "Rolls", name_ja: "ロール", sort: 30, schedule: null },
  { id: cat("04"), slug: "onigiri", name_de: "Onigiri", name_en: "Onigiri", name_ja: "おにぎり", sort: 40, schedule: null },
  { id: cat("05"), slug: "udon", name_de: "Udon", name_en: "Udon", name_ja: "うどん", sort: 50, schedule: null },
  { id: cat("06"), slug: "ramen", name_de: "Ramen", name_en: "Ramen", name_ja: "ラーメン", sort: 60, schedule: null },
  { id: cat("07"), slug: "donburi", name_de: "Donburi", name_en: "Donburi", name_ja: "丼", sort: 70, schedule: null },
  { id: cat("08"), slug: "menus", name_de: "Menüs", name_en: "Menus", name_ja: "定食", sort: 80, schedule: null },
  { id: cat("09"), slug: "drinks", name_de: "Getränke", name_en: "Drinks", name_ja: "飲み物", sort: 90, schedule: null },
  { id: cat("10"), slug: "desserts", name_de: "Desserts", name_en: "Desserts", name_ja: "デザート", sort: 100, schedule: null },
];

const SIDES = [item("09"), item("10"), item("11"), item("12")];

type ItemSeed = Omit<MenuItem, "photos" | "recommended_item_ids" | "max_per_order"> & { recommended_item_ids?: string[] };
const mk = (s: ItemSeed): MenuItem => ({ photos: [], max_per_order: null, ...s, recommended_item_ids: s.recommended_item_ids ?? [] });

export const MOCK_ITEMS: MenuItem[] = [
  mk({ id: item("01"), sku: "RL-014", category_id: cat("03"), name_de: "Philadelphia Deluxe", name_en: "Philadelphia Deluxe", name_ja: "フィラデルフィア", transliteration: "firaderufia",
    description_de: "Norwegischer Lachs, Frischkäse, Avocado und Gurke, in Sushireis gerollt, mit Tobiko. Serviert mit Wasabi, Ingwer und Shoyu.",
    description_en: "Norwegian salmon, cream cheese, avocado and cucumber, rolled in sushi rice and finished with tobiko. Served with wasabi, ginger and shoyu.",
    base_price_cents: 1490, tags: ["hit"], prep_minutes: 12, allergens: ["A", "D", "G", "F"], weight_g: 320, kcal_per_100g: 180, sort: 10, recommended_item_ids: SIDES }),
  mk({ id: item("02"), sku: "ST-001", category_id: cat("01"), name_de: "Shosho Signature Set", name_en: "Shosho Signature Set", name_ja: "特選セット", transliteration: "tokusen setto",
    description_de: "24 Stück · vier Sorten. Unsere Auswahl des Tages.", description_en: "24 pcs · four kinds. Our selection of the day.",
    base_price_cents: 3890, tags: ["hit"], prep_minutes: 18, allergens: ["A", "D", "F", "G", "N"], weight_g: 960, kcal_per_100g: 175, sort: 10, recommended_item_ids: SIDES }),
  mk({ id: item("03"), sku: "RM-001", category_id: cat("06"), name_de: "Tonkotsu Ramen", name_en: "Tonkotsu Ramen", name_ja: "ラーメン", transliteration: "tonkotsu rāmen",
    description_de: "480 g · 14 h Schweineknochenbrühe, Chashu, weiches Ei, Nori.", description_en: "480 g · 14 h pork bone broth, chashu, soft egg, nori.",
    base_price_cents: 1350, tags: [], prep_minutes: 14, allergens: ["A", "C", "F"], weight_g: 480, kcal_per_100g: 95, sort: 10, recommended_item_ids: SIDES }),
  mk({ id: item("04"), sku: "UD-001", category_id: cat("05"), name_de: "Chicken Shiitake Udon", name_en: "Chicken Shiitake Udon", name_ja: "うどん", transliteration: "chikin shiitake udon",
    description_de: "450 g · Hähnchen, Shiitake, weiches Ei, Dashi.", description_en: "450 g · chicken, shiitake, soft egg, dashi.",
    base_price_cents: 1100, tags: [], prep_minutes: 12, allergens: ["A", "C", "F"], weight_g: 450, kcal_per_100g: 88, sort: 10, recommended_item_ids: SIDES }),
  mk({ id: item("05"), sku: "DB-001", category_id: cat("07"), name_de: "Salmon Donburi", name_en: "Salmon Donburi", name_ja: "サーモン丼", transliteration: "sāmon don",
    description_de: "380 g · Reisschale mit Lachs, Avocado, Edamame, Sesam.", description_en: "380 g · rice bowl with salmon, avocado, edamame, sesame.",
    base_price_cents: 1290, tags: ["new"], prep_minutes: 10, allergens: ["D", "F", "K"], weight_g: 380, kcal_per_100g: 150, sort: 10, recommended_item_ids: SIDES }),
  mk({ id: item("06"), sku: "ON-001", category_id: cat("04"), name_de: "Onigiri Trio", name_en: "Onigiri Trio", name_ja: "おにぎり", transliteration: "onigiri",
    description_de: "3 Stück · Thunfisch, Lachs, Pflaume.", description_en: "3 pcs · tuna, salmon, plum.",
    base_price_cents: 750, tags: [], prep_minutes: 6, allergens: ["D", "F"], weight_g: 240, kcal_per_100g: 165, sort: 10 }),
  mk({ id: item("07"), sku: "RL-003", category_id: cat("03"), name_de: "California Crab", name_en: "California Crab", name_ja: "カリフォルニア", transliteration: "kariforunia",
    description_de: "8 Stück · Krabbe, Avocado und Gurke, mit Tobiko.", description_en: "8 pcs · crab, avocado, cucumber, finished with tobiko.",
    base_price_cents: 1240, tags: [], prep_minutes: 10, allergens: ["B", "D", "F"], weight_g: 300, kcal_per_100g: 170, sort: 20, recommended_item_ids: SIDES }),
  // Ebi Tempura is stoplisted today in the seed → not on sale → not in the mock catalogue.
  mk({ id: item("09"), sku: "MN-001", category_id: cat("08"), name_de: "Misosuppe", name_en: "Miso soup", name_ja: "味噌汁", transliteration: "misoshiru",
    description_de: "250 ml · Tofu, Wakame, Frühlingszwiebel.", description_en: "250 ml · tofu, wakame, spring onion.",
    base_price_cents: 320, tags: ["vegetarian"], prep_minutes: 3, allergens: ["F"], weight_g: 250, kcal_per_100g: 35, sort: 20 }),
  mk({ id: item("10"), sku: "MN-002", category_id: cat("08"), name_de: "Wakame-Salat", name_en: "Wakame salad", name_ja: "わかめサラダ", transliteration: "wakame sarada",
    description_de: "150 g · Seetang, Sesamöl, Sesam.", description_en: "150 g · seaweed, sesame oil, sesame.",
    base_price_cents: 450, tags: ["vegetarian"], prep_minutes: 3, allergens: ["F", "K"], weight_g: 150, kcal_per_100g: 45, sort: 30 }),
  mk({ id: item("11"), sku: "DR-001", category_id: cat("09"), name_de: "Grüner Tee", name_en: "Green tea", name_ja: "緑茶", transliteration: "ryokucha",
    description_de: "0,33 l · kalt, ungesüßt.", description_en: "0.33 l · cold, unsweetened.",
    base_price_cents: 280, tags: ["vegetarian"], prep_minutes: 1, allergens: [], weight_g: 330, kcal_per_100g: 0, sort: 10 }),
  mk({ id: item("12"), sku: "DS-001", category_id: cat("10"), name_de: "Mochi ×3", name_en: "Mochi ×3", name_ja: "もち", transliteration: "mochi",
    description_de: "3 Stück · Matcha, Mango, Sesam.", description_en: "3 pcs · matcha, mango, sesame.",
    base_price_cents: 540, tags: ["vegetarian"], prep_minutes: 2, allergens: ["A", "G", "K"], weight_g: 120, kcal_per_100g: 210, sort: 10 }),
  mk({ id: item("13"), sku: "SU-001", category_id: cat("02"), name_de: "Sake Nigiri", name_en: "Salmon Nigiri", name_ja: "サーモン握り", transliteration: "sāmon nigiri",
    description_de: "2 Stück · Lachs.", description_en: "2 pcs · salmon.",
    base_price_cents: 420, tags: [], prep_minutes: 5, allergens: ["D"], weight_g: 70, kcal_per_100g: 160, sort: 10 }),
  mk({ id: item("14"), sku: "SU-002", category_id: cat("02"), name_de: "Maguro Nigiri", name_en: "Tuna Nigiri", name_ja: "まぐろ握り", transliteration: "maguro nigiri",
    description_de: "2 Stück · Thunfisch.", description_en: "2 pcs · tuna.",
    base_price_cents: 490, tags: [], prep_minutes: 5, allergens: ["D"], weight_g: 70, kcal_per_100g: 150, sort: 20 }),
];

export const MOCK_GROUPS: Record<string, OptionGroup> = {
  size: {
    id: grp("01"), name_de: "Portionsgröße", name_en: "Size", min_select: 1, max_select: 1, required: true,
    options: [
      { id: opt("101"), name_de: "8 Stück · 320 g", name_en: "8 pcs · 320 g", price_cents: 0, sort: 1 },
      { id: opt("102"), name_de: "16 Stück · 640 g", name_en: "16 pcs · 640 g", price_cents: 1400, sort: 2 },
      { id: opt("103"), name_de: "24 Stück · 960 g", name_en: "24 pcs · 960 g", price_cents: 2700, sort: 3 },
    ],
  },
  wasabi: {
    id: grp("02"), name_de: "Wasabi & Ingwer", name_en: "Wasabi & ginger", min_select: 0, max_select: null, required: false,
    options: [
      { id: opt("201"), name_de: "Extra Wasabi", name_en: "Extra wasabi", price_cents: 50, sort: 1 },
      { id: opt("202"), name_de: "Ingwer", name_en: "Ginger", price_cents: 50, sort: 2 },
      { id: opt("203"), name_de: "Ohne Wasabi", name_en: "No wasabi", price_cents: 0, sort: 3 },
    ],
  },
  soy: {
    id: grp("03"), name_de: "Sojasauce", name_en: "Soy sauce", min_select: 1, max_select: 1, required: true,
    options: [
      { id: opt("301"), name_de: "Klassisch", name_en: "Classic", price_cents: 0, sort: 1 },
      { id: opt("302"), name_de: "Salzarm", name_en: "Low salt", price_cents: 0, sort: 2 },
      { id: opt("303"), name_de: "Glutenfrei (Tamari)", name_en: "Gluten-free (tamari)", price_cents: 0, sort: 3 },
      { id: opt("304"), name_de: "Keine", name_en: "None", price_cents: 0, sort: 4 },
    ],
  },
  topping: {
    id: grp("04"), name_de: "Extra Topping", name_en: "Extra topping", min_select: 0, max_select: 3, required: false,
    options: [
      { id: opt("401"), name_de: "Unagi-Sauce", name_en: "Unagi sauce", price_cents: 80, sort: 1 },
      { id: opt("402"), name_de: "Spicy Mayo", name_en: "Spicy mayo", price_cents: 80, sort: 2 },
      { id: opt("403"), name_de: "Avocado", name_en: "Avocado", price_cents: 150, sort: 3 },
      { id: opt("404"), name_de: "Tobiko", name_en: "Tobiko", price_cents: 120, sort: 4 },
      { id: opt("405"), name_de: "Sesam", name_en: "Sesame", price_cents: 30, sort: 5 },
      { id: opt("406"), name_de: "Frühlingszwiebel", name_en: "Spring onion", price_cents: 30, sort: 6 },
    ],
  },
  cutlery: {
    id: grp("05"), name_de: "Besteck", name_en: "Cutlery", min_select: 0, max_select: null, required: false,
    options: [
      { id: opt("501"), name_de: "Stäbchen ×2", name_en: "Chopsticks ×2", price_cents: 0, sort: 1 },
      { id: opt("502"), name_de: "Gabel", name_en: "Fork", price_cents: 0, sort: 2 },
    ],
  },
};

const g = MOCK_GROUPS;
const shared = [g.wasabi!, g.soy!, g.topping!, g.cutlery!];
export const MOCK_ITEM_OPTION_GROUPS: ItemOptionGroups[] = [
  { item_id: item("01"), groups: [g.size!, ...shared] },
  ...["02", "07", "13", "14", "06", "05"].map((n) => ({ item_id: item(n), groups: shared })),
  { item_id: item("03"), groups: [g.topping!, g.cutlery!] },
  { item_id: item("04"), groups: [g.topping!, g.cutlery!] },
];

export const MOCK_ZONES: DeliveryZone[] = [
  { code: "A", name: "Zone A", areas: "Mitte, Prenzlauer Berg", min_order_cents: 1500, fee_cents: 0, free_delivery_over_cents: 3500, promised_minutes: 45,
    postal_codes: ["10115", "10117", "10119", "10178", "10179", "10405", "10407", "10409", "10435", "10437", "10439"] },
  { code: "B", name: "Zone B", areas: "Friedrichshain, Wedding", min_order_cents: 2200, fee_cents: 290, free_delivery_over_cents: 3500, promised_minutes: 60,
    postal_codes: ["10243", "10245", "10247", "10249", "13347", "13349", "13351", "13353", "13355", "13357", "13359"] },
  { code: "C", name: "Zone C", areas: "Kreuzberg (part)", min_order_cents: 3000, fee_cents: 490, free_delivery_over_cents: 3500, promised_minutes: 75,
    postal_codes: ["10961", "10963", "10965", "10967", "10969", "10997", "10999"] },
];

export const MOCK_SETTINGS: PublicSettings = {
  business: {
    name: "Shosho Sushi GmbH",
    address: { street: "Torstraße 000", postal_code: "10119", city: "Berlin", country: "DE" },
    phone: "+49 30 0000000",
    email: "hello@shosho.berlin",
    impressum: "Shosho Sushi GmbH · Torstraße 000 · 10119 Berlin · Geschäftsführer: K. Sato · HRB 000000 B (Amtsgericht Charlottenburg)",
    ust_id: "DE000000000",
  },
  opening_hours: {
    mon: [["11:00", "23:00"]], tue: [["11:00", "23:00"]], wed: [["11:00", "23:00"]], thu: [["11:00", "23:00"]],
    fri: [["11:00", "24:00"]], sat: [["11:00", "24:00"]], sun: [["12:00", "22:00"]], holidays: [],
  },
  site: {
    seo: { title: "SHOSHO — Sushi, Ramen & Bowls in Berlin", description: "Fresh sushi, ramen and bowls, delivered in 60 minutes in Mitte, Prenzlauer Berg, Friedrichshain and Kreuzberg." },
    cookie_banner: true, robots: "index,follow", maintenance: false, free_delivery_hint_cents: 3500,
  },
  payments_enabled: { methods: ["card", "apple_pay", "google_pay", "paypal", "bitcoin", "cash"], tip_presets_cents: [0, 100, 200, 500], capture: "on_delivery" },
  kitchen_status: { paused: false, since: null },
};

/** Private `ops` settings the mock quote needs (not readable by anon in production). */
export const MOCK_OPS = { prep_default_min: 22, rush_extra_min: 15, preorder_max_days: 7, auto_accept_paid_under_cents: 5000, pickup_discount_pct: 10 };

export const MOCK_PROMOS = [
  { code: "SHOSHO10", kind: "percent" as const, value: 10, min_order_cents: 2000, scope: "all", days: null as number[] | null, until: null as string | null },
  { code: "WILLKOMMEN", kind: "fixed" as const, value: 500, min_order_cents: 2500, scope: "first_order", days: null, until: null },
  { code: "LUNCH15", kind: "percent" as const, value: 15, min_order_cents: 1500, scope: "all", days: [1, 2, 3, 4, 5], until: "15:00" },
];
