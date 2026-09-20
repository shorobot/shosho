-- [S2-01] 07 — triggers: updated_at, order status → timeline event, promo used_count (api-contracts §1.6)

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'staff', 'delivery_zones',
    'menu_categories', 'menu_items', 'option_groups', 'options',
    'customers', 'customer_addresses',
    'orders', 'order_items', 'promo_codes'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end
$$;

-- Actor resolution for timeline events. RPCs set the transaction-local GUCs
-- shosho.actor_type / shosho.actor_id; otherwise fall back to the JWT (staff) or 'system'.
create or replace function public.current_actor(out actor_type public.actor_type, out actor_id uuid)
language plpgsql
stable
as $$
declare
  t text := nullif(current_setting('shosho.actor_type', true), '');
  i text := nullif(current_setting('shosho.actor_id', true), '');
begin
  if t is not null then
    actor_type := t::public.actor_type;
    actor_id := i::uuid;
  elsif auth.uid() is not null and exists (select 1 from public.staff where id = auth.uid()) then
    actor_type := 'staff';
    actor_id := auth.uid();
  else
    actor_type := 'system';
    actor_id := null;
  end if;
end;
$$;

-- BEFORE UPDATE: stamp the *_at columns for the new status.
create or replace function public.orders_before_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'accepted'         then new.accepted_at  := coalesce(new.accepted_at, now());
                                   if new.accepted_by is null and auth.uid() is not null
                                      and exists (select 1 from public.staff where id = auth.uid()) then
                                     new.accepted_by := auth.uid();
                                   end if;
      when 'preparing'        then new.preparing_at := coalesce(new.preparing_at, now());
      when 'ready'            then new.ready_at     := coalesce(new.ready_at, now());
      when 'out_for_delivery' then new.out_at       := coalesce(new.out_at, now());
      when 'delivered', 'picked_up'
                              then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelled'        then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;
  return new;
end;
$$;
create trigger orders_before_status_change
  before update of status on public.orders
  for each row execute function public.orders_before_status_change();

-- AFTER UPDATE: one timeline event per status change (the "Verlauf").
create or replace function public.orders_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  ev text;
begin
  if new.status is distinct from old.status then
    select * into a from public.current_actor();
    ev := case new.status
      when 'out_for_delivery' then 'handed_to_driver'
      else new.status::text
    end;
    insert into public.order_events (order_id, type, actor_type, actor_id, payload)
    values (
      new.id, ev, a.actor_type, a.actor_id,
      jsonb_strip_nulls(jsonb_build_object(
        'from', old.status, 'to', new.status,
        'cancel_reason', case when new.status = 'cancelled' then new.cancel_reason end,
        'driver_id', case when new.status = 'out_for_delivery' then new.driver_id end,
        'promised_minutes', case when new.status = 'preparing' then new.promised_minutes end
      ))
    );
  end if;
  return new;
end;
$$;
create trigger orders_after_status_change
  after update of status on public.orders
  for each row execute function public.orders_after_status_change();

-- Promo usage counter: +1 when an order is created with a promo code.
create or replace function public.orders_count_promo_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.promo_code is not null then
    update public.promo_codes set used_count = used_count + 1 where code = new.promo_code;
  end if;
  return new;
end;
$$;
create trigger orders_count_promo_use
  after insert on public.orders
  for each row execute function public.orders_count_promo_use();
