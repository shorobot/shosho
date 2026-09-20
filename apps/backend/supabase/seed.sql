-- [S2-01] seed — idempotent (fixed UUIDs + on conflict). Data from /docs/design.
-- Run: supabase db reset (local) · supabase db push --include-seed (staging).
-- Test logins (local + staging) — see apps/backend/README.md:
--   owner@shosho.test / operator@shosho.test / kitchen@shosho.test / driver@shosho.test — password: shosho-test-2026

begin;

---------------------------------------------------------------- settings
insert into public.settings (key, value) values
  ('business', '{
    "name": "Shosho Sushi GmbH",
    "address": {"street": "Torstraße 000", "postal_code": "10119", "city": "Berlin", "country": "DE"},
    "phone": "+49 30 0000000",
    "email": "hello@shosho.berlin",
    "impressum": "Shosho Sushi GmbH · Torstraße 000 · 10119 Berlin · Geschäftsführer: K. Sato · HRB 000000 B (Amtsgericht Charlottenburg)",
    "ust_id": "DE000000000"
  }'),
  ('opening_hours', '{
    "mon": [["11:00","23:00"]], "tue": [["11:00","23:00"]], "wed": [["11:00","23:00"]], "thu": [["11:00","23:00"]],
    "fri": [["11:00","24:00"]], "sat": [["11:00","24:00"]], "sun": [["12:00","22:00"]],
    "holidays": []
  }'),
  ('ops', '{
    "prep_default_min": 22,
    "rush_extra_min": 15,
    "preorder_max_days": 7,
    "auto_accept_paid_under_cents": 5000,
    "pause_allowed": true,
    "pickup_discount_pct": 10
  }'),
  ('payments', '{
    "provider": "stripe",
    "cash_on_delivery": true,
    "payout": {"iban_last4": null}
  }'),
  ('payments.enabled', '{
    "methods": ["card", "apple_pay", "google_pay", "paypal", "bitcoin", "cash"],
    "tip_presets_cents": [0, 100, 200, 500],
    "capture": "on_delivery"
  }'),
  ('kitchen', '{"paused": false, "paused_by": null, "paused_at": null, "rush": false}'),
  ('kitchen.status', '{"paused": false, "since": null}'),
  ('site', '{
    "seo": {"title": "SHOSHO — Sushi, Ramen & Bowls in Berlin", "description": "Fresh sushi, ramen and bowls, delivered in 60 minutes in Mitte, Prenzlauer Berg, Friedrichshain and Kreuzberg."},
    "cookie_banner": true,
    "robots": "index,follow",
    "maintenance": false,
    "free_delivery_hint_cents": 3500
  }')
on conflict (key) do update set value = excluded.value;

---------------------------------------------------------------- staff (auth.users + public.staff)
-- Password for all four: shosho-test-2026 (bcrypt via pgcrypto).
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user
)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       extensions.crypt('shosho-test-2026', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', name),
       now(), now(), '', '', '', '', false
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'owner@shosho.test',    'K. Sato'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'operator@shosho.test', 'Marek K.'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'kitchen@shosho.test',  'Lena N.'),
  ('10000000-0000-4000-8000-000000000004'::uuid, 'driver@shosho.test',   'Jonas M.')
) as u(id, email, name)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select u.id, u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
               '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004')
on conflict (provider_id, provider) do nothing;

insert into public.staff (id, name, role, phone, active) values
  ('10000000-0000-4000-8000-000000000001', 'K. Sato',  'owner',    '+491700000001', true),
  ('10000000-0000-4000-8000-000000000002', 'Marek K.', 'operator', '+491700000002', true),
  ('10000000-0000-4000-8000-000000000003', 'Lena N.',  'kitchen',  '+491700000003', true),
  ('10000000-0000-4000-8000-000000000004', 'Jonas M.', 'driver',   '+491700000004', true)
on conflict (id) do update set name = excluded.name, role = excluded.role, phone = excluded.phone, active = excluded.active;

---------------------------------------------------------------- delivery zones
insert into public.delivery_zones (id, code, name, areas, min_order_cents, fee_cents, free_delivery_over_cents, promised_minutes, active, postal_codes) values
  ('50000000-0000-4000-8000-000000000001', 'A', 'Zone A', 'Mitte, Prenzlauer Berg',      1500,   0, 3500, 45, true,
     array['10115','10117','10119','10178','10179','10405','10407','10409','10435','10437','10439']),
  ('50000000-0000-4000-8000-000000000002', 'B', 'Zone B', 'Friedrichshain, Wedding',     2200, 290, 3500, 60, true,
     array['10243','10245','10247','10249','13347','13349','13351','13353','13355','13357','13359']),
  ('50000000-0000-4000-8000-000000000003', 'C', 'Zone C', 'Kreuzberg (part)',            3000, 490, 3500, 75, true,
     array['10961','10963','10965','10967','10969','10997','10999'])
on conflict (code) do update set
  name = excluded.name, areas = excluded.areas, min_order_cents = excluded.min_order_cents,
  fee_cents = excluded.fee_cents, free_delivery_over_cents = excluded.free_delivery_over_cents,
  promised_minutes = excluded.promised_minutes, active = excluded.active, postal_codes = excluded.postal_codes;

---------------------------------------------------------------- menu categories (rail from the design, with kana)
insert into public.menu_categories (id, slug, name_de, name_en, name_ja, sort, active, schedule) values
  ('20000000-0000-4000-8000-000000000001', 'sets',     'Sets',     'Sets',     'セット',  10, true, null),
  ('20000000-0000-4000-8000-000000000002', 'sushi',    'Sushi',    'Sushi',    '寿司',    20, true, null),
  ('20000000-0000-4000-8000-000000000003', 'rolls',    'Rolls',    'Rolls',    'ロール',  30, true, null),
  ('20000000-0000-4000-8000-000000000004', 'onigiri',  'Onigiri',  'Onigiri',  'おにぎり', 40, true, null),
  ('20000000-0000-4000-8000-000000000005', 'udon',     'Udon',     'Udon',     'うどん',  50, true, null),
  ('20000000-0000-4000-8000-000000000006', 'ramen',    'Ramen',    'Ramen',    'ラーメン', 60, true, null),
  ('20000000-0000-4000-8000-000000000007', 'donburi',  'Donburi',  'Donburi',  '丼',      70, true, null),
  ('20000000-0000-4000-8000-000000000008', 'menus',    'Menüs',    'Menus',    '定食',    80, true, null),
  ('20000000-0000-4000-8000-000000000009', 'drinks',   'Getränke', 'Drinks',   '飲み物',  90, true, null),
  ('20000000-0000-4000-8000-000000000010', 'desserts', 'Desserts', 'Desserts', 'デザート', 100, true, null)
on conflict (slug) do update set
  name_de = excluded.name_de, name_en = excluded.name_en, name_ja = excluded.name_ja,
  sort = excluded.sort, active = excluded.active, schedule = excluded.schedule;

---------------------------------------------------------------- option groups + options
insert into public.option_groups (id, name_de, name_en, shared, min_select, max_select, required) values
  ('40000000-0000-4000-8000-000000000001', 'Portionsgröße',   'Size',           false, 1, 1,    true),   -- exactly one, item-only
  ('40000000-0000-4000-8000-000000000002', 'Wasabi & Ingwer', 'Wasabi & ginger', true, 0, null, false),  -- any number
  ('40000000-0000-4000-8000-000000000003', 'Sojasauce',       'Soy sauce',       true, 1, 1,    true),   -- exactly one
  ('40000000-0000-4000-8000-000000000004', 'Extra Topping',   'Extra topping',   true, 0, 3,    false),  -- 0–3
  ('40000000-0000-4000-8000-000000000005', 'Besteck',         'Cutlery',         true, 0, null, false)   -- any number
on conflict (id) do update set
  name_de = excluded.name_de, name_en = excluded.name_en, shared = excluded.shared,
  min_select = excluded.min_select, max_select = excluded.max_select, required = excluded.required;

insert into public.options (id, group_id, name_de, name_en, price_cents, sort, active) values
  -- Size (Philadelphia Deluxe): 8 / 16 / 24 pcs
  ('41000000-0000-4000-8000-000000000101', '40000000-0000-4000-8000-000000000001', '8 Stück · 320 g',  '8 pcs · 320 g',     0, 1, true),
  ('41000000-0000-4000-8000-000000000102', '40000000-0000-4000-8000-000000000001', '16 Stück · 640 g', '16 pcs · 640 g', 1400, 2, true),
  ('41000000-0000-4000-8000-000000000103', '40000000-0000-4000-8000-000000000001', '24 Stück · 960 g', '24 pcs · 960 g', 2700, 3, true),
  -- Wasabi & ginger
  ('41000000-0000-4000-8000-000000000201', '40000000-0000-4000-8000-000000000002', 'Extra Wasabi', 'Extra wasabi', 50, 1, true),
  ('41000000-0000-4000-8000-000000000202', '40000000-0000-4000-8000-000000000002', 'Ingwer',       'Ginger',       50, 2, true),
  ('41000000-0000-4000-8000-000000000203', '40000000-0000-4000-8000-000000000002', 'Ohne Wasabi',  'No wasabi',     0, 3, true),
  -- Soy sauce
  ('41000000-0000-4000-8000-000000000301', '40000000-0000-4000-8000-000000000003', 'Klassisch',    'Classic',        0, 1, true),
  ('41000000-0000-4000-8000-000000000302', '40000000-0000-4000-8000-000000000003', 'Salzarm',      'Low salt',       0, 2, true),
  ('41000000-0000-4000-8000-000000000303', '40000000-0000-4000-8000-000000000003', 'Glutenfrei (Tamari)', 'Gluten-free (tamari)', 0, 3, true),
  ('41000000-0000-4000-8000-000000000304', '40000000-0000-4000-8000-000000000003', 'Keine',        'None',           0, 4, true),
  -- Extra topping
  ('41000000-0000-4000-8000-000000000401', '40000000-0000-4000-8000-000000000004', 'Unagi-Sauce',  'Unagi sauce',   80, 1, true),
  ('41000000-0000-4000-8000-000000000402', '40000000-0000-4000-8000-000000000004', 'Spicy Mayo',   'Spicy mayo',    80, 2, true),
  ('41000000-0000-4000-8000-000000000403', '40000000-0000-4000-8000-000000000004', 'Avocado',      'Avocado',      150, 3, true),
  ('41000000-0000-4000-8000-000000000404', '40000000-0000-4000-8000-000000000004', 'Tobiko',       'Tobiko',       120, 4, true),
  ('41000000-0000-4000-8000-000000000405', '40000000-0000-4000-8000-000000000004', 'Sesam',        'Sesame',        30, 5, true),
  ('41000000-0000-4000-8000-000000000406', '40000000-0000-4000-8000-000000000004', 'Frühlingszwiebel', 'Spring onion', 30, 6, true),
  -- Cutlery
  ('41000000-0000-4000-8000-000000000501', '40000000-0000-4000-8000-000000000005', 'Stäbchen ×2',  'Chopsticks ×2',  0, 1, true),
  ('41000000-0000-4000-8000-000000000502', '40000000-0000-4000-8000-000000000005', 'Gabel',        'Fork',           0, 2, true)
on conflict (id) do update set
  group_id = excluded.group_id, name_de = excluded.name_de, name_en = excluded.name_en,
  price_cents = excluded.price_cents, sort = excluded.sort, active = excluded.active;

---------------------------------------------------------------- menu items
insert into public.menu_items (
  id, sku, category_id, name_de, name_en, name_ja, transliteration, description_de, description_en,
  base_price_cents, cost_cents, available, stoplist_until, tags, prep_minutes, station,
  allergens, weight_g, kcal_per_100g, sort
) values
  ('30000000-0000-4000-8000-000000000001', 'RL-014', '20000000-0000-4000-8000-000000000003',
   'Philadelphia Deluxe', 'Philadelphia Deluxe', 'フィラデルフィア', 'firaderufia',
   'Norwegischer Lachs, Frischkäse, Avocado und Gurke, in Sushireis gerollt, mit Tobiko. Serviert mit Wasabi, Ingwer und Shoyu.',
   'Norwegian salmon, cream cheese, avocado and cucumber, rolled in sushi rice and finished with tobiko. Served with wasabi, ginger and shoyu.',
   1490, 510, true, null, array['hit'], 12, 'sushi', array['A','D','G','F'], 320, 180, 10),
  ('30000000-0000-4000-8000-000000000002', 'ST-001', '20000000-0000-4000-8000-000000000001',
   'Shosho Signature Set', 'Shosho Signature Set', '特選セット', 'tokusen setto',
   '24 Stück · vier Sorten. Unsere Auswahl des Tages.',
   '24 pcs · four kinds. Our selection of the day.',
   3890, 1480, true, null, array['hit'], 18, 'sushi', array['A','D','F','G','N'], 960, 175, 10),
  ('30000000-0000-4000-8000-000000000003', 'RM-001', '20000000-0000-4000-8000-000000000006',
   'Tonkotsu Ramen', 'Tonkotsu Ramen', 'ラーメン', 'tonkotsu rāmen',
   '480 g · 14 h Schweineknochenbrühe, Chashu, weiches Ei, Nori.',
   '480 g · 14 h pork bone broth, chashu, soft egg, nori.',
   1350, 420, true, null, array[]::text[], 14, 'hot', array['A','C','F'], 480, 95, 10),
  ('30000000-0000-4000-8000-000000000004', 'UD-001', '20000000-0000-4000-8000-000000000005',
   'Chicken Shiitake Udon', 'Chicken Shiitake Udon', 'うどん', 'chikin shiitake udon',
   '450 g · Hähnchen, Shiitake, weiches Ei, Dashi.',
   '450 g · chicken, shiitake, soft egg, dashi.',
   1100, 360, true, null, array[]::text[], 12, 'hot', array['A','C','F'], 450, 88, 10),
  ('30000000-0000-4000-8000-000000000005', 'DB-001', '20000000-0000-4000-8000-000000000007',
   'Salmon Donburi', 'Salmon Donburi', 'サーモン丼', 'sāmon don',
   '380 g · Reisschale mit Lachs, Avocado, Edamame, Sesam.',
   '380 g · rice bowl with salmon, avocado, edamame, sesame.',
   1290, 490, true, null, array['new'], 10, 'cold', array['D','F','K'], 380, 150, 10),
  ('30000000-0000-4000-8000-000000000006', 'ON-001', '20000000-0000-4000-8000-000000000004',
   'Onigiri Trio', 'Onigiri Trio', 'おにぎり', 'onigiri',
   '3 Stück · Thunfisch, Lachs, Pflaume.',
   '3 pcs · tuna, salmon, plum.',
   750, 210, true, null, array[]::text[], 6, 'cold', array['D','F'], 240, 165, 10),
  ('30000000-0000-4000-8000-000000000007', 'RL-003', '20000000-0000-4000-8000-000000000003',
   'California Crab', 'California Crab', 'カリフォルニア', 'kariforunia',
   '8 Stück · Krabbe, Avocado und Gurke, mit Tobiko.',
   '8 pcs · crab, avocado, cucumber, finished with tobiko.',
   1240, 430, true, null, array[]::text[], 10, 'sushi', array['B','D','F'], 300, 170, 20),
  ('30000000-0000-4000-8000-000000000008', 'MN-004', '20000000-0000-4000-8000-000000000008',
   'Ebi Tempura', 'Ebi Tempura', '天ぷら', 'ebi tenpura',
   '6 Stück · Garnele im Tempurateig, Tentsuyu.',
   '6 pcs · prawn in tempura batter, tentsuyu.',
   980, 340, true, (now() at time zone 'Europe/Berlin')::date, array[]::text[], 9, 'hot', array['A','B','C','F'], 180, 210, 10),
  ('30000000-0000-4000-8000-000000000009', 'MN-001', '20000000-0000-4000-8000-000000000008',
   'Misosuppe', 'Miso soup', '味噌汁', 'misoshiru',
   '250 ml · Tofu, Wakame, Frühlingszwiebel.',
   '250 ml · tofu, wakame, spring onion.',
   320, 60, true, null, array['vegetarian'], 3, 'hot', array['F'], 250, 35, 20),
  ('30000000-0000-4000-8000-000000000010', 'MN-002', '20000000-0000-4000-8000-000000000008',
   'Wakame-Salat', 'Wakame salad', 'わかめサラダ', 'wakame sarada',
   '150 g · Seetang, Sesamöl, Sesam.',
   '150 g · seaweed, sesame oil, sesame.',
   450, 90, true, null, array['vegetarian'], 3, 'cold', array['F','K'], 150, 45, 30),
  ('30000000-0000-4000-8000-000000000011', 'DR-001', '20000000-0000-4000-8000-000000000009',
   'Grüner Tee', 'Green tea', '緑茶', 'ryokucha',
   '0,33 l · kalt, ungesüßt.',
   '0.33 l · cold, unsweetened.',
   280, 40, true, null, array['vegetarian'], 1, 'bar', array[]::text[], 330, 0, 10),
  ('30000000-0000-4000-8000-000000000012', 'DS-001', '20000000-0000-4000-8000-000000000010',
   'Mochi ×3', 'Mochi ×3', 'もち', 'mochi',
   '3 Stück · Matcha, Mango, Sesam.',
   '3 pcs · matcha, mango, sesame.',
   540, 130, true, null, array['vegetarian'], 2, 'cold', array['A','G','K'], 120, 210, 10),
  ('30000000-0000-4000-8000-000000000013', 'SU-001', '20000000-0000-4000-8000-000000000002',
   'Sake Nigiri', 'Salmon Nigiri', 'サーモン握り', 'sāmon nigiri',
   '2 Stück · Lachs.',
   '2 pcs · salmon.',
   420, 140, true, null, array[]::text[], 5, 'sushi', array['D'], 70, 160, 10),
  ('30000000-0000-4000-8000-000000000014', 'SU-002', '20000000-0000-4000-8000-000000000002',
   'Maguro Nigiri', 'Tuna Nigiri', 'まぐろ握り', 'maguro nigiri',
   '2 Stück · Thunfisch.',
   '2 pcs · tuna.',
   490, 190, true, null, array[]::text[], 5, 'sushi', array['D'], 70, 150, 20)
on conflict (sku) do update set
  category_id = excluded.category_id, name_de = excluded.name_de, name_en = excluded.name_en,
  name_ja = excluded.name_ja, transliteration = excluded.transliteration,
  description_de = excluded.description_de, description_en = excluded.description_en,
  base_price_cents = excluded.base_price_cents, cost_cents = excluded.cost_cents,
  available = excluded.available, stoplist_until = excluded.stoplist_until, tags = excluded.tags,
  prep_minutes = excluded.prep_minutes, station = excluded.station, allergens = excluded.allergens,
  weight_g = excluded.weight_g, kcal_per_100g = excluded.kcal_per_100g, sort = excluded.sort;

-- recommendations ("Goes well with"): miso soup, wakame salad, green tea, mochi
update public.menu_items set recommended_item_ids = array[
  '30000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000010',
  '30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012']::uuid[]
where sku in ('RL-014', 'ST-001', 'RM-001', 'UD-001', 'DB-001', 'RL-003');

-- item ↔ option groups
insert into public.menu_item_option_groups (item_id, group_id, sort)
select i.id, g.group_id, g.sort
from public.menu_items i
join (values
  -- Philadelphia Deluxe: size (item-only) + all shared groups
  ('RL-014', '40000000-0000-4000-8000-000000000001'::uuid, 1),
  ('RL-014', '40000000-0000-4000-8000-000000000002'::uuid, 2),
  ('RL-014', '40000000-0000-4000-8000-000000000003'::uuid, 3),
  ('RL-014', '40000000-0000-4000-8000-000000000004'::uuid, 4),
  ('RL-014', '40000000-0000-4000-8000-000000000005'::uuid, 5),
  -- shared groups on the other 7 sushi / roll / set items ("SHARED · 8 ITEMS")
  ('ST-001', '40000000-0000-4000-8000-000000000002'::uuid, 1), ('ST-001', '40000000-0000-4000-8000-000000000003'::uuid, 2), ('ST-001', '40000000-0000-4000-8000-000000000004'::uuid, 3), ('ST-001', '40000000-0000-4000-8000-000000000005'::uuid, 4),
  ('RL-003', '40000000-0000-4000-8000-000000000002'::uuid, 1), ('RL-003', '40000000-0000-4000-8000-000000000003'::uuid, 2), ('RL-003', '40000000-0000-4000-8000-000000000004'::uuid, 3), ('RL-003', '40000000-0000-4000-8000-000000000005'::uuid, 4),
  ('SU-001', '40000000-0000-4000-8000-000000000002'::uuid, 1), ('SU-001', '40000000-0000-4000-8000-000000000003'::uuid, 2), ('SU-001', '40000000-0000-4000-8000-000000000004'::uuid, 3), ('SU-001', '40000000-0000-4000-8000-000000000005'::uuid, 4),
  ('SU-002', '40000000-0000-4000-8000-000000000002'::uuid, 1), ('SU-002', '40000000-0000-4000-8000-000000000003'::uuid, 2), ('SU-002', '40000000-0000-4000-8000-000000000004'::uuid, 3), ('SU-002', '40000000-0000-4000-8000-000000000005'::uuid, 4),
  ('ON-001', '40000000-0000-4000-8000-000000000002'::uuid, 1), ('ON-001', '40000000-0000-4000-8000-000000000003'::uuid, 2), ('ON-001', '40000000-0000-4000-8000-000000000004'::uuid, 3), ('ON-001', '40000000-0000-4000-8000-000000000005'::uuid, 4),
  ('DB-001', '40000000-0000-4000-8000-000000000002'::uuid, 1), ('DB-001', '40000000-0000-4000-8000-000000000003'::uuid, 2), ('DB-001', '40000000-0000-4000-8000-000000000004'::uuid, 3), ('DB-001', '40000000-0000-4000-8000-000000000005'::uuid, 4),
  ('MN-004', '40000000-0000-4000-8000-000000000002'::uuid, 1), ('MN-004', '40000000-0000-4000-8000-000000000003'::uuid, 2), ('MN-004', '40000000-0000-4000-8000-000000000004'::uuid, 3), ('MN-004', '40000000-0000-4000-8000-000000000005'::uuid, 4),
  -- hot dishes: cutlery + extra topping
  ('RM-001', '40000000-0000-4000-8000-000000000004'::uuid, 1), ('RM-001', '40000000-0000-4000-8000-000000000005'::uuid, 2),
  ('UD-001', '40000000-0000-4000-8000-000000000004'::uuid, 1), ('UD-001', '40000000-0000-4000-8000-000000000005'::uuid, 2)
) as g(sku, group_id, sort) on g.sku = i.sku
on conflict (item_id, group_id) do update set sort = excluded.sort;

---------------------------------------------------------------- promo codes
insert into public.promo_codes (id, code, kind, value, min_order_cents, applies_to, usage_limit, used_count, valid_from, valid_to, active) values
  ('60000000-0000-4000-8000-000000000001', 'SHOSHO10',   'percent', 10,   2000, '{"scope":"all"}',                                  null, 0, '2026-01-01', '2026-12-31 23:59:59+01', true),
  ('60000000-0000-4000-8000-000000000002', 'WILLKOMMEN', 'fixed',   500,  2500, '{"scope":"first_order"}',                          1000, 0, '2026-01-01', null, true),
  ('60000000-0000-4000-8000-000000000003', 'LUNCH15',    'percent', 15,   1500, '{"scope":"all","days":[1,2,3,4,5],"until":"15:00"}', null, 0, '2026-01-01', null, true)
on conflict (code) do update set
  kind = excluded.kind, value = excluded.value, min_order_cents = excluded.min_order_cents,
  applies_to = excluded.applies_to, usage_limit = excluded.usage_limit,
  valid_from = excluded.valid_from, valid_to = excluded.valid_to, active = excluded.active;

commit;
