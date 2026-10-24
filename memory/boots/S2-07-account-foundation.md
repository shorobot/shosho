# BOOT: S2-07 (Backend) — the customer account foundation, and the linking rule that must not inherit an allergy note

## Role
You are session S2 (Backend) of SHOSHO. This is **phase A** of
`memory/boots/proposed/ROADMAP-customer-accounts-and-push.md`: the backend foundation for **optional**
customer accounts — login identity, the cabinet's read/write surface, saved addresses, and the RLS that
keeps a customer inside their own rows.

**The owner confirmed the clause this phase was waiting on, on 2026-10-22:** accounts are **optional** and
**guest checkout survives unchanged as a first-class path**. That was the one part of D-016 they had never
answered out loud, and A was explicitly not issuable without it. It is now D-016's recorded text, not an
inference.

**You are not blocked by the SMTP/SMS question, and you must not try to answer it.** D4 (an SMTP provider)
and the SMS provider/rate-limiting preconditions gate the *channel going live*, which is phase B's problem
and the owner's. Your work is channel-agnostic by construction: you key on "the verified identifier",
whichever channel produced it. **Configure no channel, add no provider key, touch no Supabase Auth
dashboard setting.**

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in
`/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2` run `git fetch origin && git checkout -f -B s2-07 origin/main`.
Use `checkout -f`, not `reset --hard` — a stale staged index otherwise blocks the checkout. Never touch
another session's worktree; never bare `git stash`.

Read first, in this order:
1. `memory/decisions.md` — **D-016** (accounts optional, OTP by both channels, bonuses deferred), **D-017**
   (email OTP must not ship against Supabase's built-in relay), **D-021** (the email tie-break below).
2. `memory/boots/proposed/ROADMAP-customer-accounts-and-push.md` — **finding 5** is the heart of this boot;
   **section A** is your scope; the dependency diagram shows what waits on you.
3. `apps/backend/supabase/migrations/20260920000004_customers.sql` — `customers` and `customer_addresses`
   as they actually are today.
4. `docs/api-contracts.md` §8 — the shape your new functions must document themselves in.

### What S0 measured for you, so you do not re-derive it
- **34 migrations today**, the last being `20261016000034_agent_role.sql`. Yours is **35**.
- **`customers.auth_user_id` does not exist** — zero occurrences repo-wide. You add it.
- **`customer_addresses` already exists** (migration 4) with `label, street, floor_apt, postal_code, city,
  zone_id, is_default`, keyed by `customer_id`, indexed. **You are writing CRUD and RLS over an existing
  table, not creating one.** The ROADMAP's phrase "address CRUD" has been misread as "create a table"
  before; it is not.
- **`customers.phone` is `text not null unique`**, E.164, normalised by `place_order`.
  **`customers.email` is nullable and has NO unique constraint or index** — checked, repo-wide. This is the
  asymmetry that makes finding 5 harder than it reads, and D-021 rules on it.
- **`customers.kitchen_note`'s own column comment** is *"Allergy / kitchen note — copied to
  orders.allergy_note on every order."* That is why mis-linking is a **food-safety** defect and not a
  privacy footnote.
- **The backend is already safe by construction against a second class of authenticated user, and your job
  is to preserve that property rather than repair it.** `auth_role()` is
  `select role from public.staff where id = auth.uid() and active` — a *lookup*, so a customer gets `null`
  and `is_staff()` coalesces to `false`. Every `to authenticated` policy carries an explicit `is_staff(...)`
  predicate except `staff_self_read`, which is `id = auth.uid()` and therefore correct. The two functions
  granted `to authenticated` with no inline predicate — `set_order_status`, `add_customer_event` — both
  guard internally and raise (`not_staff` / `forbidden_for_role`, `42501`). **Nothing currently tests any of
  this with a non-staff JWT, because no customer has ever had one.** That test is task 5 and it is the single
  most valuable thing in this boot.

## Tasks

**1. Migration 35 — the identity column.**
`customers.auth_user_id uuid unique references auth.users (id) on delete set null`, **nullable**, with an
index. Nullable is the whole point: every guest-created customer row has no account and must keep working
untouched. `on delete set null` so deleting an auth user orphans the account link rather than cascading
away a customer's order history.

**2. The linking rule — finding 5, implemented and tested, including the recycled-number case.**
The rule, which is not negotiable because it is a safety rule:
> Link on first login **only** when the account's verified identifier matches the customer row's identifier
> **and** that row has no other account attached. Otherwise start a **fresh** customer row and let staff
> merge deliberately from the back-office, with the merge audited in `customer_events`.
> **Never merge on a phone match alone.**

**D-021 settles the email half, which finding 5 left under-specified.** Phone is unique, so a phone match is
either zero rows or exactly one. Email is nullable and non-unique, so an email match can be zero, one, or
**many** rows. Therefore:
- Match on a verified **phone** → at most one candidate; link it if it has no `auth_user_id`.
- Match on a verified **email** → link **only if exactly one** non-anonymised row carries that email **and**
  it has no `auth_user_id`. Two or more candidates → **fresh row**, never a guess.
- **A `NULL` email never matches anything.** Guard it explicitly; `null = null` is not the trap here, a
  careless `where email = p_email` with a null parameter is.
- A row with `anonymised_at` set is never a link candidate.

**Implement this as an explicit `link_my_account()` RPC, not as a trigger on `auth.users`.** S0's ruling,
with the reasoning so you can overturn it if you measure something better: (a) the rule has to be able to
**refuse** and leave the account deliberately unlinked, and a trigger has no way to tell the client that
happened; (b) an `auth.users` trigger cannot be tested with a real customer JWT, which is exactly the
coverage this phase exists to add. If you do overturn it, say why in the report.

**3. The self-service surface, scoped to the caller.**
`get_my_profile`, `get_my_orders`, `update_my_profile`, and address CRUD over the existing
`customer_addresses`. Every one of them resolves the caller through `auth.uid() → customers.auth_user_id`
and **never takes a customer id from the client**. `update_my_profile` must not let a customer write
`kitchen_note`, `tags`, `is_company`, or any consent column by a path that skips the existing consent
trigger — decide and state which fields are customer-writable, and defend the list in the report.
`is_default` on addresses needs a rule (at most one default per customer); pick one and enforce it in the
database rather than hoping the UI does.

**4. RLS for a customer, not a staff member.**
A customer reads only their own `customers` row, their own `customer_addresses`, and their own orders —
and **cannot read anyone else's `kitchen_note` by any path, including a join or a view**. Remember the
`report_payments` lesson (D-012 era): a `security_invoker` view is only as tight as the loosest policy on
anything it joins, and `orders_kitchen_read` is still `using (public.is_staff('kitchen'))` with no row
restriction (open item **B4**). So do not build a customer-facing view over `orders` and assume it narrows;
check the joined tables' policies, or use a function with its own guard.

**5. The regression test that matters most — a real customer JWT must be refused everywhere.**
Assert, with an actual non-staff JWT, that a customer is refused by **every staff surface and every
report**. S7's own helpers already exist and are the cheap way in:
`security_audit_policies` / `security_audit_table_grants` / `security_audit_function_grants` — re-run the
matrix with a **customer** JWT as a new column. The expectation is that everything refuses; a pass that
*confirms* it is a high-value result precisely because it currently holds only as a side effect.
**Include the silent-no-op case:** this project has repeatedly found that plain table writes fail *silently*
(`[]`, no error) while functions with internal guards raise `42501`. A test that only checks "no rows came
back" cannot tell a refusal from an empty result — assert the distinction.

**6. Contract.** Write **one** new section in `docs/api-contracts.md` for the self-service surface
(request/response shape, the refusal codes, and the linking rule's outcomes including "did not link, staff
merge required"). That is the only section you touch; S0 reviews it. Flag anything you believe §8 gets
wrong as a numbered request in `memory/boots/proposed/S2-contract-request.md` rather than editing elsewhere.

## Boundaries
- **No channel work of any kind.** No SMTP, no SMS provider, no Supabase Auth dashboard setting, no
  provider key, no Turnstile. D-017 and the owner's D4 own that.
- **No front-end.** `apps/web` and `apps/backoffice` are not yours — login screens, the cabinet UI and the
  address form are phase B (S3-04).
- **Do not update `docs/design/README.md` or the twelve-rule list.** D-016 requires the product-rule change
  to land in **the same boot that ships the login**, which is B, not A. Shipping it here would mark a rule
  retired while the feature it describes does not exist yet.
- **Do not implement bonuses.** Deferred by D-016; zero schema support; a session inventing loyalty rules is
  exactly what that decision prevents.
- **Do not touch** `apps/e2e/` or `apps/backoffice/e2e/` (S6's fences), or any other session's worktree.
- **Do not fix B4/B5** (`orders_kitchen_read`, `settings.draft` reaching kitchen/driver) even though you
  will read them while doing task 4. They are yours, but they are separate items with their own blast
  radius — note what you observe and leave them.
- Migrations are **append-only**. Do not edit 1–34.

## Done when
- [ ] Migration 35 adds `customers.auth_user_id` (nullable, unique, indexed, `on delete set null`) and
      nothing else structural.
- [ ] `link_my_account()` implements the rule in task 2 **and** D-021's email tie-break, with tests for:
      phone match → links; phone match on a row already linked → fresh row; **recycled number** → fresh row
      and the stranger's `kitchen_note` provably unreachable; email matching **two** rows → fresh row;
      `NULL` email → matches nothing; `anonymised_at` row → never a candidate.
- [ ] `get_my_profile` / `get_my_orders` / `update_my_profile` / address CRUD all resolve the caller from
      `auth.uid()`, take no client-supplied customer id, and are tested for cross-customer refusal.
- [ ] The customer-writable field list is decided, enforced, and defended in the report.
- [ ] At most one default address per customer, enforced in the database.
- [ ] **A real customer JWT is refused by every staff surface and every report**, asserted — with refusals
      distinguished from empty results.
- [ ] Guest checkout is **proved unchanged**: `place_order` still creates a customer row with
      `auth_user_id` null and the full guest path still works end to end. This is the clause the owner just
      confirmed; it needs evidence, not an assurance.
- [ ] One new `docs/api-contracts.md` section; `supabase db push` clean against `shosho-staging`; all
      existing tests still green.

## Reporting
Append one entry to `memory/log.md` and update **only the S2 row** in `memory/state.md`. Open a PR and
leave the merge to S0 (D-009). In the report, be explicit about:
- anything you measured that contradicts this boot — **including anything S0 got wrong here**; that has
  happened in most phases and is the most useful half of a report;
- whether you overturned the `link_my_account()`-over-trigger ruling, and why;
- what you observed about B4/B5 while doing task 4, without fixing them;
- anything you could **not** verify, stated as not verified rather than implied.

## Next step after you
Phase **B (S3-04)** — login + cabinet + address UI, which also carries D-016's required update to the
product-rule list. **B cannot ship until the owner resolves a channel:** email needs D4 (SMTP, D-017), SMS
needs a provider plus the rate-limiting/Turnstile preconditions. Phase **C** — the auth-surface security
audit — **is renumbered S7-04**, because the `S7-03` the ROADMAP names was spent on the automation
privilege boundary (PR #95, merged 2026-10-16). C can run in parallel with you and is **blocking for the
SMS channel specifically**.
