-- [S2-01] 06 — promo codes (api-contracts §1.5; campaigns/automations/banners = S2-02)

create table public.promo_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code = upper(code)),
  kind            public.promo_kind not null,
  value           integer not null check (value > 0),
  min_order_cents integer not null default 0 check (min_order_cents >= 0),
  applies_to      jsonb not null default '{"scope":"all"}'::jsonb,
  usage_limit     integer check (usage_limit is null or usage_limit > 0),
  used_count      integer not null default 0 check (used_count >= 0),
  valid_from      timestamptz,
  valid_to        timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on column public.promo_codes.value is 'percent → 1..100; fixed → cents.';
comment on column public.promo_codes.applies_to is '{"scope":"all"|"category"|"first_order","category_id":uuid?,"days":[1..7]?,"until":"HH:MM"?}';
