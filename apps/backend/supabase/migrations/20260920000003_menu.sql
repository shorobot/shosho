-- [S2-01] 03 — menu: categories, items, option groups, options, m2m (api-contracts §1.2)

create table public.menu_categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name_de    text not null,
  name_en    text not null,
  name_ja    text,
  sort       integer not null default 0,
  active     boolean not null default true,
  schedule   jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.menu_categories.schedule is 'Optional availability window, e.g. {"days":[1,2,3,4,5],"until":"15:00"} (ISO weekday 1=Mon, Europe/Berlin).';

create table public.menu_items (
  id                   uuid primary key default gen_random_uuid(),
  sku                  text not null unique,
  category_id          uuid not null references public.menu_categories (id) on delete restrict,
  name_de              text not null,
  name_en              text not null,
  name_ja              text,
  transliteration      text,
  description_de       text,
  description_en       text,
  base_price_cents     integer not null check (base_price_cents >= 0),
  cost_cents           integer check (cost_cents is null or cost_cents >= 0),
  photos               jsonb not null default '[]'::jsonb,
  available            boolean not null default true,
  stoplist_until       date,
  stock_remaining      integer check (stock_remaining is null or stock_remaining >= 0),
  max_per_order        integer check (max_per_order is null or max_per_order > 0),
  tags                 text[] not null default '{}',
  prep_minutes         integer,
  station              text,
  kitchen_note         text,
  allergens            text[] not null default '{}',
  weight_g             integer,
  kcal_per_100g        integer,
  vat_delivery_pct     numeric(4,2) not null default 7,
  vat_onsite_pct       numeric(4,2) not null default 19,
  sort                 integer not null default 0,
  recommended_item_ids uuid[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index menu_items_category_idx on public.menu_items (category_id, sort);
comment on column public.menu_items.stoplist_until is 'Item is off sale while stoplist_until >= current_date (Europe/Berlin). Stoplist "till midnight" = current_date.';

create table public.option_groups (
  id         uuid primary key default gen_random_uuid(),
  name_de    text not null,
  name_en    text not null,
  shared     boolean not null default false,
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer check (max_select is null or max_select >= 1),
  required   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_select is null or max_select >= min_select)
);
comment on table public.option_groups is 'Rules from design: any (0,null), exactly one (1,1,required), 0–3 (0,3).';

create table public.options (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.option_groups (id) on delete cascade,
  name_de     text not null,
  name_en     text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  sort        integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index options_group_idx on public.options (group_id, sort);

create table public.menu_item_option_groups (
  item_id  uuid not null references public.menu_items (id) on delete cascade,
  group_id uuid not null references public.option_groups (id) on delete cascade,
  sort     integer not null default 0,
  primary key (item_id, group_id)
);
create index menu_item_option_groups_group_idx on public.menu_item_option_groups (group_id);

-- "on sale" rule (§1.2), reused by RLS, the view and the RPCs.
create or replace function public.menu_item_on_sale(item public.menu_items)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select item.available
     and (item.stoplist_until is null or item.stoplist_until < (now() at time zone 'Europe/Berlin')::date)
     and exists (select 1 from public.menu_categories c where c.id = item.category_id and c.active)
$$;
revoke execute on function public.menu_item_on_sale(public.menu_items) from public;
grant execute on function public.menu_item_on_sale(public.menu_items) to anon, authenticated, service_role;
