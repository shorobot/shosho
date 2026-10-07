-- [S2-06] 29 — resolve_segment, claim_campaign_recipients (api-contracts §7)
--
-- resolve_segment is deliberately a TWO-argument function (p_segment, p_channel), not the
-- one-argument shape the proposal sketched. The proposal's framing — "the wizard's 'recipients'
-- number and the actual send use one implementation" — only holds if both calls resolve the SAME
-- channel-specific eligible set; a one-argument version would have to fold channel into the
-- segment jsonb itself, where a caller could omit it silently. Making channel a required SQL
-- parameter means "I forgot to say which channel" is a syntax error, not a silently-too-broad
-- result — which is exactly what "a caller who forgets consent gets fewer rows, never more" asks
-- for. No shipped RPC's signature changes here; this function is new in this migration.

create or replace function public.resolve_segment(p_segment jsonb, p_channel public.campaign_channel)
returns table (
  customer_id       uuid,
  has_email_consent boolean,
  has_push_consent  boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'operator') then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.consent_email is not null,
    c.consent_push  is not null
  from public.customers c
  left join public.customer_stats cs on cs.customer_id = c.id
  where
    -- CONSENT AND ANONYMISATION ARE CHECKED FIRST, UNCONDITIONALLY — not a `segment` key, so no
    -- caller-supplied filter can bypass them. A customer with no consent for `p_channel`, or who
    -- has been anonymised, is excluded before any of the segment's own criteria are even looked at.
    c.anonymised_at is null
    and case p_channel
          when 'email' then c.consent_email is not null
          when 'push'  then c.consent_push  is not null
          when 'both'  then c.consent_email is not null or c.consent_push is not null
          else false   -- defensive: a channel value added later with no case here excludes everyone,
                        -- not everyone — "fewer rows, never more" even against a future enum value.
        end
    -- Segment filters below: every one is `(key absent → true)`, so an empty `{}` segment matches
    -- every consented, non-anonymised customer — the baseline above is never the thing a filter
    -- can loosen. Shape documented on campaigns.segment (migration 27).
    and (p_segment->'customer_ids' is null
         or c.id in (select jsonb_array_elements_text(p_segment->'customer_ids')::uuid))
    and (p_segment->'tags' is null
         or c.tags && (select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(p_segment->'tags') x))
    and (p_segment->>'is_company' is null
         or c.is_company = (p_segment->>'is_company')::boolean)
    and (p_segment->>'min_orders' is null
         or coalesce(cs.orders_count, 0) >= (p_segment->>'min_orders')::integer)
    and (p_segment->>'max_orders' is null
         or coalesce(cs.orders_count, 0) <= (p_segment->>'max_orders')::integer)
    and (p_segment->>'min_days_silent' is null
         or coalesce(cs.days_silent, 2147483647) >= (p_segment->>'min_days_silent')::integer)
    and (p_segment->>'max_days_silent' is null
         or coalesce(cs.days_silent, -1) <= (p_segment->>'max_days_silent')::integer)
    and (p_segment->>'created_within_days' is null
         or c.created_at >= now() - ((p_segment->>'created_within_days')::integer || ' days')::interval);
end;
$$;
revoke execute on function public.resolve_segment(jsonb, public.campaign_channel) from public, anon;
grant execute on function public.resolve_segment(jsonb, public.campaign_channel) to authenticated, service_role;

---------------------------------------------------------------- claim_campaign_recipients
-- Shaped exactly like claim_payment_jobs (migration 11): `for update skip locked` so two workers
-- never claim the same row, a stale-claim timeout (`claimed_at`) so a worker that died mid-send
-- does not strand the row forever. Unlike payment_jobs there is no `processing` status to set —
-- campaign_recipients.state stays `queued` through a claim; `claimed_at` alone marks "in flight".
--
-- UNREACHABLE WITH ANON OR AUTHENTICATED — this is the exact shape S7-01/S1 found wrong in
-- `payment-worker` (anon key, service-role authority). Revoked from both explicitly, not just
-- `public`, per the standing rule (migration 18's own lesson) and asserted in
-- tests/campaigns.test.ts, not only in this grant.
create or replace function public.claim_campaign_recipients(p_limit integer default 50)
returns setof public.campaign_recipients
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id from public.campaign_recipients
     where state = 'queued'
       and (claimed_at is null or claimed_at < now() - interval '10 minutes')
     order by created_at
     limit greatest(coalesce(p_limit, 50), 1)
     for update skip locked
  )
  update public.campaign_recipients r
     set claimed_at = now()
    from picked
   where r.id = picked.id
  returning r.*;
$$;
revoke execute on function public.claim_campaign_recipients(integer) from public, anon, authenticated;
grant execute on function public.claim_campaign_recipients(integer) to service_role;
