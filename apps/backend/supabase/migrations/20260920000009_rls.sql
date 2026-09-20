-- [S2-01] 09 — RLS (api-contracts §4)
--
-- Roles: anon (guest site) · authenticated staff via auth_role(): owner / operator / kitchen / driver
-- · service_role bypasses RLS (automation, S5).
-- anon never touches orders / customers / staff directly — only through security-definer RPCs (10_rpc.sql).

-- Public settings keys (everything else in settings is private).
create or replace function public.settings_public_keys()
returns text[]
language sql
immutable
as $$ select array['business', 'opening_hours', 'site', 'payments.enabled', 'kitchen.status'] $$;

alter table public.settings                enable row level security;
alter table public.staff                   enable row level security;
alter table public.delivery_zones          enable row level security;
alter table public.menu_categories         enable row level security;
alter table public.menu_items              enable row level security;
alter table public.option_groups           enable row level security;
alter table public.options                 enable row level security;
alter table public.menu_item_option_groups enable row level security;
alter table public.customers               enable row level security;
alter table public.customer_addresses      enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.order_events            enable row level security;
alter table public.promo_codes             enable row level security;

---------------------------------------------------------------- settings
create policy settings_public_read on public.settings
  for select to anon, authenticated
  using (key = any (public.settings_public_keys()));
create policy settings_staff_read on public.settings
  for select to authenticated
  using (public.is_staff('owner', 'operator'));
create policy settings_owner_write on public.settings
  for all to authenticated
  using (public.is_staff('owner')) with check (public.is_staff('owner'));

---------------------------------------------------------------- staff
create policy staff_self_read on public.staff
  for select to authenticated
  using (id = auth.uid());
create policy staff_read on public.staff
  for select to authenticated
  using (public.is_staff('owner', 'operator'));
create policy staff_owner_write on public.staff
  for all to authenticated
  using (public.is_staff('owner')) with check (public.is_staff('owner'));

---------------------------------------------------------------- delivery_zones
create policy zones_public_read on public.delivery_zones
  for select to anon, authenticated
  using (active);
create policy zones_staff_read on public.delivery_zones
  for select to authenticated
  using (public.is_staff('owner', 'operator'));
create policy zones_staff_write on public.delivery_zones
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

---------------------------------------------------------------- menu
create policy categories_public_read on public.menu_categories
  for select to anon, authenticated
  using (active);
create policy categories_staff_read on public.menu_categories
  for select to authenticated
  using (public.is_staff('owner', 'operator', 'kitchen'));
create policy categories_staff_write on public.menu_categories
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

create policy items_public_read on public.menu_items
  for select to anon, authenticated
  using (public.menu_item_on_sale(menu_items));
create policy items_staff_read on public.menu_items
  for select to authenticated
  using (public.is_staff('owner', 'operator', 'kitchen'));
create policy items_staff_write on public.menu_items
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

create policy option_groups_public_read on public.option_groups
  for select to anon, authenticated
  using (true);
create policy option_groups_staff_write on public.option_groups
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

create policy options_public_read on public.options
  for select to anon, authenticated
  using (active);
create policy options_staff_read on public.options
  for select to authenticated
  using (public.is_staff('owner', 'operator', 'kitchen'));
create policy options_staff_write on public.options
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

create policy item_option_groups_public_read on public.menu_item_option_groups
  for select to anon, authenticated
  using (true);
create policy item_option_groups_staff_write on public.menu_item_option_groups
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

---------------------------------------------------------------- customers
create policy customers_staff_all on public.customers
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));
create policy customer_addresses_staff_all on public.customer_addresses
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

---------------------------------------------------------------- orders
create policy orders_staff_all on public.orders
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));
create policy orders_kitchen_read on public.orders
  for select to authenticated
  using (public.is_staff('kitchen'));
create policy orders_driver_read on public.orders
  for select to authenticated
  using (public.is_staff('driver') and driver_id = auth.uid());

create policy order_items_staff_all on public.order_items
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));
create policy order_items_kitchen_read on public.order_items
  for select to authenticated
  using (public.is_staff('kitchen'));
create policy order_items_driver_read on public.order_items
  for select to authenticated
  using (public.is_staff('driver') and exists (
    select 1 from public.orders o where o.id = order_items.order_id and o.driver_id = auth.uid()));

create policy order_events_staff_all on public.order_events
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));
create policy order_events_kitchen_read on public.order_events
  for select to authenticated
  using (public.is_staff('kitchen'));
create policy order_events_driver_read on public.order_events
  for select to authenticated
  using (public.is_staff('driver') and exists (
    select 1 from public.orders o where o.id = order_events.order_id and o.driver_id = auth.uid()));

---------------------------------------------------------------- promo_codes
create policy promo_codes_staff_all on public.promo_codes
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

---------------------------------------------------------------- sequence
-- Orders are inserted only by place_order (security definer) or owner/operator.
revoke all on sequence public.order_number_seq from anon;
