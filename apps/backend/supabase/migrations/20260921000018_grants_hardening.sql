-- [S2-02] 18 — grants hardening (finding while testing S2-02)
--
-- Supabase's default privileges grant EXECUTE on every function created in `public` by `postgres`
-- to `anon`, `authenticated` and `service_role` (the cloud default, `auto_expose_new_tables`).
-- `revoke execute … from public` (S2-01 and the S2-02 migrations above) does NOT remove those
-- role grants, so `anon` could call staff- and service-only functions and was stopped only by the
-- role check inside them. This migration revokes the role grants themselves, so a function the
-- contract calls staff-only is not even reachable with the anon key.
--
-- Unchanged and still callable by anon (api-contracts §5): quote_order, place_order,
-- get_order_by_token, shop_open_at, normalize_phone, auth_role, is_staff, settings_public_keys,
-- menu_item_on_sale. No signature or return shape changes anywhere.

---------------------------------------------------------------- staff-only RPCs (§2, §6)
revoke execute on function public.set_order_status(uuid, public.order_status, jsonb) from anon;
revoke execute on function public.kitchen_pause(boolean)                            from anon;
revoke execute on function public.update_order_items(uuid, jsonb)                   from anon;
revoke execute on function public.add_customer_event(uuid, text, jsonb)             from anon;
revoke execute on function public.anonymise_silent_customers(integer)               from anon;

---------------------------------------------------------------- service-role-only (Edge Functions, cron)
revoke execute on function public.record_payment_event(text, text, text, jsonb, text, uuid, text, public.payment_method) from anon, authenticated;
revoke execute on function public.enqueue_payment_job(uuid, public.payment_job_action, integer)                          from anon, authenticated;
revoke execute on function public.claim_payment_jobs(integer)                                                           from anon, authenticated;
revoke execute on function public.finish_payment_job(uuid, boolean, text, jsonb, boolean)                                from anon, authenticated;
revoke execute on function public.schedule_payment_worker(text, text)                                                    from anon, authenticated;
revoke execute on function public.run_payment_worker()                                                                  from anon, authenticated;
revoke execute on function public.ensure_menu_bucket_policies()                                                         from anon, authenticated;
revoke execute on function public.ensure_guest_realtime_policy()                                                        from anon, authenticated;
revoke execute on function public.is_service_request()                                                                  from anon, authenticated;

---------------------------------------------------------------- internal helpers (trigger / RPC use only)
revoke execute on function public.current_actor()                          from anon, authenticated;
revoke execute on function public.order_transition_allowed(public.order_status, public.order_status, public.order_type, public.payment_status) from anon;
