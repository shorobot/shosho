-- [S2-01] 02 — settings, staff, delivery_zones (api-contracts §1.1)

create table public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.settings is 'Single-tenant key/value. Public keys (readable by anon): business, opening_hours, site, payments.enabled.';

create table public.staff (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  role       public.staff_role not null,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.staff is 'One row per team member; id = auth.users.id. Role drives RLS via auth_role().';

create table public.delivery_zones (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  name                     text not null,
  areas                    text,
  min_order_cents          integer not null default 0 check (min_order_cents >= 0),
  fee_cents                integer not null default 0 check (fee_cents >= 0),
  free_delivery_over_cents integer check (free_delivery_over_cents is null or free_delivery_over_cents >= 0),
  promised_minutes         integer not null check (promised_minutes > 0),
  active                   boolean not null default true,
  postal_codes             text[] not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
comment on column public.delivery_zones.free_delivery_over_cents is 'Subtotal from which delivery is free in this zone (null = never free). Addition to §1.1 — see /memory/boots/proposed/S2-contract-change.md.';
create index delivery_zones_postal_codes_idx on public.delivery_zones using gin (postal_codes);

-- Stable helper: role of the calling staff member (null for anon / non-staff / inactive).
-- security definer so it can read public.staff regardless of the caller's RLS.
create or replace function public.auth_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff where id = auth.uid() and active
$$;
revoke execute on function public.auth_role() from public;
grant execute on function public.auth_role() to anon, authenticated, service_role;

create or replace function public.is_staff(variadic roles public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.auth_role() = any (roles), false)
$$;
revoke execute on function public.is_staff(variadic public.staff_role[]) from public;
grant execute on function public.is_staff(variadic public.staff_role[]) to anon, authenticated, service_role;
