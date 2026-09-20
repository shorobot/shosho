-- [S2-01] 08 — views: customer_stats, menu_items_on_sale (api-contracts §1.2, §1.3)
-- security_invoker: the caller's RLS applies to the underlying tables.

create view public.customer_stats
with (security_invoker = true)
as
select
  c.id as customer_id,
  (count(o.id) filter (where o.status not in ('cancelled', 'refunded')))::integer as orders_count,
  coalesce(sum(o.total_cents) filter (where o.status not in ('cancelled', 'refunded')), 0)::integer as spent_cents,
  coalesce(avg(o.total_cents) filter (where o.status not in ('cancelled', 'refunded')), 0)::integer as avg_cents,
  max(o.created_at) filter (where o.status not in ('cancelled', 'refunded')) as last_order_at,
  case
    when max(o.created_at) filter (where o.status not in ('cancelled', 'refunded')) is null then null
    else extract(day from now() - max(o.created_at) filter (where o.status not in ('cancelled', 'refunded')))::integer
  end as days_silent
from public.customers c
left join public.orders o on o.customer_id = c.id
group by c.id;

create view public.menu_items_on_sale
with (security_invoker = true)
as
select i.*
from public.menu_items i
where public.menu_item_on_sale(i);
