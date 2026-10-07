# Proposal → S2 Backend: per-RPC throttling for `place_order` / `quote_order`

Filed by S1 (S1-07), per the corrected S7-02 finding. **Not S1's to build — `apps/backend` is S2's,
and S2-06 is mid-boot there (D-003).** This lays out the two real options with trade-offs. S0 picks
the winner; neither is implemented here.

## Why this exists
S7-02's original rate-limiting finding assumed a Cloudflare rule could throttle `place_order` and
`quote_order`. It cannot: both are called `rpc()` from a browser Supabase client
(`apps/web/lib/api-supabase.ts:39,180,188`, driven by `apps/web/lib/cart.tsx`, `"use client"`)
straight to `https://bvmitglwwqsvufetlkff.supabase.co`, which never passes through Cloudflare's proxy
of `shos.hellfiresol.com` — `apps/web/lib/csp.ts` has to list the Supabase origin in `connect-src`
precisely because of this. See `/memory/boots/S1-07-rate-limiting.md`'s correction block for the full
measurement. Supabase Auth's own `[auth.rate_limit]` (S1-07 task 1) covers `/auth/v1/*`, but
`place_order`/`quote_order` are plain `/rest/v1/rpc/*` calls with no Auth involved (guest checkout,
no session) — nothing in Supabase's own stack throttles them today.

## Option A — throttle inside the RPCs themselves
`place_order` and `quote_order` are `security definer` functions already (per
`docs/security.md` §4's standing rules). Add a throttle check at the top of each: count recent calls
keyed on something available inside the function body, reject with a `429`-equivalent error (same
shape as `OrderRejectedError` the client already handles) past a threshold.

- **The key is the open question, and the honest caveat first:** a `security definer` RPC called via
  PostgREST has no trustworthy client IP — `request.headers` can expose `x-forwarded-for`, but that
  header is attacker-controlled unless Cloudflare (or our own edge) rewrites it, and nothing in this
  stack currently guarantees that. So "throttle by IP" is not reliable here without edge involvement,
  which brings back the Cloudflare-can't-see-this problem this proposal exists to route around.
- Realistic keys instead: **phone number** (on `place_order`, once the payload carries one — cheap,
  but a guest can supply any phone, so it caps abuse-per-claimed-identity, not abuse-per-attacker) or a
  **client-generated session id** already used for guest order tracking (`docs/security.md` §3's
  token pattern) — stronger than phone (survives phone reuse) but still client-supplied, so a
  determined attacker can mint a fresh one per request. Neither key defeats a sufficiently motivated
  attacker; both raise the cost of casual abuse (a script hammering the same phone/session) cheaply.
- A `security definer` function can see real wall-clock request volume via a small counting table
  (`insert ... on conflict do update` keyed on the chosen identifier + a time bucket), which is simple
  and needs no new infrastructure — same shape as existing migrations.
- Cost: one migration, one small table, a few lines added to two existing RPCs. No architecture
  change, no new secrets, nothing crosses a trust boundary that does not already cross it today.

## Option B — route guest RPCs through our own origin
Add a thin proxy on `apps/web`'s own server (a Next.js Route Handler or Server Action) that receives
the guest's request, holds the Supabase anon key server-side, and calls `quote_order`/`place_order`
from there instead of the browser calling Supabase directly. Browser → our Next.js server (which *is*
behind Cloudflare, proxied, same hostname) → Supabase. This is the change the original S7-02 proposal
implicitly assumed already existed (`find apps/web/app -name route.ts` → nothing today).

- **This makes Cloudflare rules (S1-07 task 3) actually apply to these two endpoints** — the thing
  task 3 had to say it honestly could not cover. That is the whole appeal of this option.
- Cost is real and spans two sessions: **S3** adds the route handler(s) and changes `cart.tsx` to call
  our own origin instead of Supabase directly (api-contracts change); **S1** confirms the new path
  through the existing deploy pipeline (no new service, same `apps/web` container, so likely no infra
  change beyond what already ships) and updates `apps/web/lib/csp.ts` (the `connect-src` entry for the
  Supabase origin can arguably narrow once the browser no longer calls it directly for these two RPCs
  — worth rechecking, not assuming, since other reads may still be browser-side).
  Moving the anon key server-side is a net security improvement on its own (per D-012's spirit,
  though the anon key is public-by-design so this is a smaller win than it sounds — the real value is
  the Cloudflare coverage, not key secrecy).
- This is an architecture change to the guest ordering path, not a config tweak — it touches a
  contract (`docs/api-contracts.md` §5) and needs S0 to issue it as a proper boot to S1+S3 together,
  not something either session does unilaterally.

## Not picking a winner
Option A is cheaper and ships inside S2's existing boundary; Option B is more thorough (gets real
Cloudflare coverage) but costs two sessions and a contract change. They are not mutually exclusive —
A could ship now as a cheap backstop and B could follow later if volume or abuse patterns justify the
bigger change. S0 decides scope and timing.
