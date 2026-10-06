-- [S2-06] 31 — banners, banners_live, storage bucket `site` (api-contracts §7;
--             proposal S2-03-reports-campaigns-cms.md §3)

create type public.banner_slot as enum ('home_hero', 'home_strip', 'product', 'checkout');

create table public.banners (
  id           uuid primary key default gen_random_uuid(),
  slot         public.banner_slot not null,
  image_path   text,                       -- bucket-qualified, e.g. "site/<id>/1.jpg" — §1.2 pattern
  title_de     text,
  title_en     text,
  subtitle_de  text,
  subtitle_en  text,
  cta_label_de text,
  cta_label_en text,
  cta_href     text,
  valid_from   timestamptz,
  valid_to     timestamptz,
  sort         integer not null default 0,
  active       boolean not null default false,
  -- [S2-06 task 7] the publish model: a partial JSON patch of the editable columns above. A key
  -- absent (or JSON null) keeps the live value — see publish_site() (migration 32) for the merge.
  -- Never selected by anon; see the base-table RLS below and banners_live's explicit column list.
  draft        jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.banners is
  'CMS content for the guest site''s banner slots. The base table is owner/operator only — a guest '
  'never reads it directly, only through banners_live, which is also where `draft` is deliberately '
  'never selected. See migration 32 for the draft → live publish flow.';

create trigger banners_set_updated_at before update on public.banners
  for each row execute function public.set_updated_at();

create index banners_slot_idx on public.banners (slot, sort) where active;

---------------------------------------------------------------- RLS — base table: staff only
alter table public.banners enable row level security;

create policy banners_staff_all on public.banners
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

-- [S2-06] Belt-and-braces, matching order_attempts (migration 23) rather than the older
-- RLS-only convention most staff-only tables use: `banners` carries unpublished `draft` content,
-- so the anon table grant is revoked outright rather than relying solely on RLS returning zero
-- rows. `banners_live` below is the ONLY anon-reachable surface for this data.
revoke all on table public.banners from anon;
grant select on table public.banners to authenticated;
grant all on table public.banners to service_role;

---------------------------------------------------------------- banners_live — the public surface
-- security_invoker = false (same reasoning as staff_directory, migration 21): the base table's own
-- RLS admits only owner/operator, so the view must run as its owner to see every row and apply its
-- OWN filter instead. The column list is explicit and does not include `draft` or `id`'s siblings
-- beyond what the guest site needs — there is nothing here for a mistake to leak through even if
-- a future column is added to `banners` without updating this view.
create view public.banners_live
with (security_invoker = false, security_barrier = true)
as
select
  id, slot, image_path, title_de, title_en, subtitle_de, subtitle_en,
  cta_label_de, cta_label_en, cta_href, sort
from public.banners
where active
  and (valid_from is null or valid_from <= now())
  and (valid_to   is null or valid_to   >= now())
order by slot, sort;

comment on view public.banners_live is
  'api-contracts §7 — active, in-window banners only, explicit column list (no draft, no active/'
  'valid_from/valid_to themselves — the WHERE clause already applied them). The only anon-readable '
  'surface for banner content; the base table is owner/operator only.';

revoke all on public.banners_live from anon;
grant select on public.banners_live to anon, authenticated, service_role;

---------------------------------------------------------------- storage bucket `site`
-- Same policy shape as bucket `menu` (migration 12, S2-02) — public read, owner/operator write.
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('site', 'site', true)
  on conflict (id) do update set public = true;

  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets
       set file_size_limit = 5242880,
           allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
     where id = 'site';
  end if;
end
$$;

create or replace function public.ensure_site_bucket_policies()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('storage.objects') is null then
    return false;
  end if;
  execute 'drop policy if exists "site assets public read"  on storage.objects';
  execute 'drop policy if exists "site assets staff insert" on storage.objects';
  execute 'drop policy if exists "site assets staff update" on storage.objects';
  execute 'drop policy if exists "site assets staff delete" on storage.objects';

  execute $p$
    create policy "site assets public read" on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'site')
  $p$;
  execute $p$
    create policy "site assets staff insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'site' and public.is_staff('owner', 'operator'))
  $p$;
  execute $p$
    create policy "site assets staff update" on storage.objects
      for update to authenticated
      using (bucket_id = 'site' and public.is_staff('owner', 'operator'))
      with check (bucket_id = 'site' and public.is_staff('owner', 'operator'))
  $p$;
  execute $p$
    create policy "site assets staff delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'site' and public.is_staff('owner', 'operator'))
  $p$;
  return true;
end;
$$;
-- [S2-06] revoked from anon AND authenticated directly, not just `public` — the menu-bucket
-- installer (migration 12) revoked only `from public` and needed migration 18 to patch the hole
-- Supabase's default per-role grants leave open; this one starts correct.
revoke execute on function public.ensure_site_bucket_policies() from public, anon, authenticated;
grant execute on function public.ensure_site_bucket_policies() to service_role;

select public.ensure_site_bucket_policies();
