-- [S2-02] 16 — guest tracking realtime (api-contracts §3)
--
-- Why not a token-scoped view + header RLS: Realtime evaluates `postgres_changes` RLS with the
-- subscriber's JWT only (no request headers), views are not part of the WAL publication, and the
-- anon JWT is the same for every guest — so nothing row-level can be keyed on a header. Instead we
-- use Realtime *broadcast from the database*: a trigger on `orders` sends a message to the
-- private topic `order:<tracking_token>`; the token (16 random bytes) is the capability, exactly
-- like get_order_by_token. The payload carries no PII — the client re-fetches get_order_by_token.
--
-- Client (S3): supabase.channel('order:' + token, { config: { private: true } })
--                .on('broadcast', { event: 'order_updated' }, () => refetch())
--                .subscribe()

-- Anyone (anon or staff) may *receive* on `order:*` topics; nobody may publish from the client.
-- realtime.messages is created by the Realtime service's own migrations — on a hosted project it
-- exists before this migration runs; in the local CLI stack it may appear only after `db reset`
-- restarts the containers. Hence an idempotent installer, run here and callable later
-- (service role; the test suite calls it before the realtime test).
create or replace function public.ensure_guest_realtime_policy()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('realtime.messages') is null then
    return false;
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'realtime' and tablename = 'messages' and policyname = 'guest order topics read') then
    execute $p$
      create policy "guest order topics read" on realtime.messages
        for select to anon, authenticated
        using (realtime.topic() like 'order:%' and extension = 'broadcast')
    $p$;
  end if;
  return true;
end;
$$;
revoke execute on function public.ensure_guest_realtime_policy() from public;
grant execute on function public.ensure_guest_realtime_policy() to service_role;

do $$
begin
  perform public.ensure_guest_realtime_policy();
exception when others then
  -- realtime is owned by supabase_realtime_admin on some stacks; the suite / a later call installs it
  raise notice 'guest realtime policy not installed yet: %', sqlerrm;
end
$$;

create or replace function public.orders_broadcast_tracking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.payment_status is not distinct from old.payment_status
     and new.promised_minutes is not distinct from old.promised_minutes
     and new.scheduled_for is not distinct from old.scheduled_for
     and new.total_cents is not distinct from old.total_cents
     and new.driver_id is not distinct from old.driver_id then
    return new;
  end if;
  -- realtime.send(payload, event, topic, private) — present on hosted projects and the CLI stack;
  -- guarded so a stack without it (or a failing Realtime) never breaks an order update.
  begin
    if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
      -- dynamic so plpgsql_check (db lint) does not need realtime.send to exist at lint time
      execute 'select realtime.send($1, $2, $3, true)'
        using jsonb_build_object(
          'order_id', new.id,
          'number', new.number,
          'status', new.status,
          'payment_status', new.payment_status,
          'promised_minutes', new.promised_minutes,
          'scheduled_for', new.scheduled_for,
          'total_cents', new.total_cents,
          'updated_at', now()),
        'order_updated',
        'order:' || new.tracking_token;
    end if;
  exception when others then
    raise warning 'orders_broadcast_tracking: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger orders_broadcast_tracking
  after update on public.orders
  for each row execute function public.orders_broadcast_tracking();

-- order_items edits (update_order_items) also concern the guest — one message per order update
-- is already emitted because totals change; positions-only edits with the same total are rare
-- and the next status change catches up.
