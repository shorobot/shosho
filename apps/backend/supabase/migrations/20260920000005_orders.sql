-- [S2-01] 05 — orders, order_items, order_events, number sequence (api-contracts §1.4, §1.6)

create sequence public.order_number_seq start with 1000 increment by 1;

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  number           integer not null unique default nextval('public.order_number_seq'),
  tracking_token   text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  channel          public.order_channel not null default 'website',
  type             public.order_type not null,
  status           public.order_status not null default 'new',
  payment_status   public.payment_status not null default 'pending',
  payment_method   public.payment_method not null,
  payment_ref      text,
  customer_id      uuid references public.customers (id) on delete set null,
  contact_name     text not null,
  contact_phone    text not null,
  address          jsonb,
  zone_id          uuid references public.delivery_zones (id) on delete set null,
  distance_km      numeric(5,2),
  courier_comment  text,
  comment_flags    text[] not null default '{}',
  allergy_note     text,
  scheduled_for    timestamptz,
  promised_minutes integer,
  accepted_at      timestamptz,
  accepted_by      uuid references public.staff (id) on delete set null,
  preparing_at     timestamptz,
  ready_at         timestamptz,
  driver_id        uuid references public.staff (id) on delete set null,
  out_at           timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  subtotal_cents      integer not null default 0 check (subtotal_cents >= 0),
  discount_cents      integer not null default 0 check (discount_cents >= 0),
  delivery_fee_cents  integer not null default 0 check (delivery_fee_cents >= 0),
  tip_cents           integer not null default 0 check (tip_cents >= 0),
  total_cents         integer not null default 0 check (total_cents >= 0),
  vat_cents           integer not null default 0 check (vat_cents >= 0),
  promo_code       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on column public.orders.tracking_token is 'Opaque guest token for get_order_by_token(). Addition to §1.4 (implied by §2) — see S2-contract-change.md.';
comment on column public.orders.address is 'Snapshot {street, floor_apt, postal_code, city} — null for pickup.';
comment on column public.orders.scheduled_for is 'null = ASAP; otherwise the pre-order slot.';
create index orders_status_idx      on public.orders (status, created_at desc);
create index orders_customer_idx    on public.orders (customer_id, created_at desc);
create index orders_driver_idx      on public.orders (driver_id) where driver_id is not null;
create index orders_scheduled_idx   on public.orders (scheduled_for) where scheduled_for is not null;
create index orders_created_idx     on public.orders (created_at desc);

create table public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  item_id              uuid references public.menu_items (id) on delete set null,
  name                 text not null,
  qty                  integer not null check (qty > 0),
  unit_price_cents     integer not null check (unit_price_cents >= 0),
  options              jsonb not null default '[]'::jsonb,
  line_total_cents     integer not null check (line_total_cents >= 0),
  modified_by_operator boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on column public.order_items.options is 'Snapshot [{group_id, group, option_id, option, price_cents}].';
create index order_items_order_idx on public.order_items (order_id);

create table public.order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  at         timestamptz not null default now(),
  type       text not null,
  actor_type public.actor_type not null default 'system',
  actor_id   uuid,
  payload    jsonb not null default '{}'::jsonb
);
comment on column public.order_events.type is 'created | payment_authorized | accepted | preparing | item_changed | ready | handed_to_driver | delivered | picked_up | cancelled | refunded | note';
create index order_events_order_idx on public.order_events (order_id, at);

-- Realtime (§3): staff board / detail subscribe to these three tables.
alter publication supabase_realtime add table public.orders, public.order_items, public.order_events;
