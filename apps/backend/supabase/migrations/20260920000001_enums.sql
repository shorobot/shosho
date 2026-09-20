-- [S2-01] 01 — extensions + enums (api-contracts §1)

create extension if not exists pgcrypto with schema extensions;

create type public.staff_role as enum ('owner', 'operator', 'kitchen', 'driver');

create type public.order_channel as enum ('website', 'phone', 'instagram', 'facebook', 'lieferando', 'wolt');
create type public.order_type as enum ('delivery', 'pickup');
create type public.order_status as enum (
  'new', 'accepted', 'preparing', 'ready', 'out_for_delivery',
  'delivered', 'picked_up', 'cancelled', 'refunded'
);
create type public.payment_status as enum ('pending', 'authorized', 'paid', 'failed', 'refunded');
create type public.payment_method as enum ('card', 'apple_pay', 'google_pay', 'paypal', 'bitcoin', 'cash');

create type public.promo_kind as enum ('percent', 'fixed');
create type public.actor_type as enum ('customer', 'staff', 'system');
