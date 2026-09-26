-- SCRATCH DEMO for S7-01 — proves apps/backend/tests/security.test.ts fails CI when a migration
-- adds a function without an explicit anon/authenticated grant decision (Supabase's default
-- privileges would otherwise hand this EXECUTE to anon and authenticated). This migration is
-- pushed only to a throwaway branch to capture a red CI run for the S7-01 log entry, then reverted
-- — it must never reach `main`.
create or replace function public.demo_unlocked_staff_action()
returns text
language sql
security definer
set search_path = public
as $$ select 'this should never be anon-callable'::text $$;
