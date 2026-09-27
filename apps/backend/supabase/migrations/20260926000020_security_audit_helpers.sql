-- [S7-01] 20 — security-audit introspection helpers
--
-- `apps/backend/tests/security.test.ts` needs to assert the *cumulative* effect of every grant /
-- revoke / policy statement across all migrations, against the live catalog — not a hand-maintained
-- list that silently goes stale the next time someone adds a function or table. These three
-- functions expose exactly that, and nothing else: they are service_role-only (never granted to
-- anon/authenticated, never called by apps/web or apps/backoffice), read pg_catalog only, and write
-- nothing.
--
-- This is the regression test surface for the S2-02 finding (migration 18's own comment): Supabase's
-- default privileges grant EXECUTE on every new `public` function to `anon` and `authenticated`
-- regardless of `revoke … from public`, so a future migration that adds a function without an
-- explicit `revoke execute … from anon[, authenticated]` would silently reopen exactly that hole.
-- `security_audit_function_grants()` is what makes that failure mode visible in CI instead of in
-- production. See /docs/security.md.

create or replace function public.security_audit_function_grants()
returns table (
  proname                text,
  args                    text,
  is_trigger              boolean,
  prosecdef               boolean,
  search_path_pinned      boolean,
  anon_execute            boolean,
  authenticated_execute   boolean,
  service_role_execute    boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p.proname::text,
    pg_get_function_identity_arguments(p.oid),
    p.prorettype = 'trigger'::regtype,
    p.prosecdef,
    exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%'),
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    has_function_privilege('service_role', p.oid, 'EXECUTE')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';
$$;

-- `revoke all ... from public` alone is not enough (that's the whole point of this file, and of
-- migration 18): Supabase's default privileges grant EXECUTE to `anon`/`authenticated` directly,
-- not via the PUBLIC pseudo-role. Revoke from all three explicitly.
revoke all on function public.security_audit_function_grants() from public, anon, authenticated;
grant execute on function public.security_audit_function_grants() to service_role;

-- RLS-enabled + policy-count per table, across `public` and the two extension schemas this project
-- depends on but does not own (`storage`, `realtime`) — migration 12 and 16 both assume RLS is
-- already on for storage.objects / realtime.messages rather than asserting it; this is how the test
-- actually checks that assumption against a real, freshly-provisioned stack.
create or replace function public.security_audit_table_grants()
returns table (
  schemaname            text,
  tablename             text,
  rowsecurity           boolean,
  policy_count          integer,
  anon_select           boolean,
  authenticated_select  boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    n.nspname::text,
    c.relname::text,
    c.relrowsecurity,
    (select count(*)::integer from pg_policies pol where pol.schemaname = n.nspname and pol.tablename = c.relname),
    has_table_privilege('anon', c.oid, 'SELECT'),
    has_table_privilege('authenticated', c.oid, 'SELECT')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname in ('public', 'storage', 'realtime');
$$;

revoke all on function public.security_audit_table_grants() from public, anon, authenticated;
grant execute on function public.security_audit_table_grants() to service_role;

-- Full policy definitions (same three schemas) — lets the test assert on the actual USING / WITH
-- CHECK expressions (e.g. flag a bare `using (true)` on a table that isn't on the public-read
-- allow-list) instead of only counting policies.
create or replace function public.security_audit_policies()
returns table (
  schemaname   text,
  tablename    text,
  policyname   text,
  cmd          text,
  roles        text[],
  qual         text,
  with_check   text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select schemaname::text, tablename::text, policyname::text, cmd::text, roles::text[], qual::text, with_check::text
  from pg_policies
  where schemaname in ('public', 'storage', 'realtime');
$$;

revoke all on function public.security_audit_policies() from public, anon, authenticated;
grant execute on function public.security_audit_policies() to service_role;
