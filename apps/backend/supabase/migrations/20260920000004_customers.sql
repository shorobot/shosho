-- [S2-01] 04 — customers + addresses (api-contracts §1.3, core only; customer_events = S2-02)

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text not null unique,
  email         text,
  kitchen_note  text,
  tags          text[] not null default '{}',
  birthday      date,
  is_company    boolean not null default false,
  consent_email jsonb,
  consent_push  jsonb,
  consent_phone jsonb,
  anonymised_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.customers.phone is 'E.164 (+49…). place_order normalises German numbers.';
comment on column public.customers.kitchen_note is 'Allergy / kitchen note — copied to orders.allergy_note on every order.';
comment on column public.customers.consent_email is '{"granted_at": iso, "source": text} or null (same for push/phone).';

create table public.customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label       text,
  street      text not null,
  floor_apt   text,
  postal_code text not null,
  city        text not null default 'Berlin',
  zone_id     uuid references public.delivery_zones (id) on delete set null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index customer_addresses_customer_idx on public.customer_addresses (customer_id);
