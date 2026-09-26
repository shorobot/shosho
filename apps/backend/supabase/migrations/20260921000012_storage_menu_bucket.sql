-- [S2-02] 12 — storage bucket `menu` for menu_items.photos (api-contracts §6.8)
-- Public read (the guest site renders photos straight from the CDN URL); write only for
-- owner / operator. Object paths: `<item_id>/<n>.jpg` inside the bucket → stored in
-- menu_items.photos as "menu/<item_id>/<n>.jpg" (bucket-qualified, as §1.2 says).

-- The columns file_size_limit / allowed_mime_types are added by storage-api's own migrations,
-- which the local CLI stack may run only after ours — set them when present.
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('menu', 'menu', true)
  on conflict (id) do update set public = true;

  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets
       set file_size_limit = 5242880,
           allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
     where id = 'menu';
  end if;
end
$$;

-- storage.objects already has RLS enabled by Supabase; policies are per bucket.
-- Idempotent and re-runnable (also callable later by the test suite, like the realtime policy in 16).
create or replace function public.ensure_menu_bucket_policies()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('storage.objects') is null then
    return false;
  end if;
  execute 'drop policy if exists "menu photos public read"  on storage.objects';
  execute 'drop policy if exists "menu photos staff insert" on storage.objects';
  execute 'drop policy if exists "menu photos staff update" on storage.objects';
  execute 'drop policy if exists "menu photos staff delete" on storage.objects';

  execute $p$
    create policy "menu photos public read" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'menu')
  $p$;
  execute $p$
    create policy "menu photos staff insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'menu' and public.is_staff('owner', 'operator'))
  $p$;
  execute $p$
    create policy "menu photos staff update" on storage.objects
      for update to authenticated
      using (bucket_id = 'menu' and public.is_staff('owner', 'operator'))
      with check (bucket_id = 'menu' and public.is_staff('owner', 'operator'))
  $p$;
  execute $p$
    create policy "menu photos staff delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'menu' and public.is_staff('owner', 'operator'))
  $p$;
  return true;
end;
$$;
revoke execute on function public.ensure_menu_bucket_policies() from public;
grant execute on function public.ensure_menu_bucket_policies() to service_role;

select public.ensure_menu_bucket_policies();
