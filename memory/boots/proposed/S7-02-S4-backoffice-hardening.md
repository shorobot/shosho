# Proposal → S4 Back-office: open redirect fix, security headers, cookie flags

From S7 Security. Full context: `/docs/security.md` §5, `/memory/log.md` S7-01 entry. The back-office
is the more sensitive of the two apps (staff auth, order edits, refunds) and doesn't have a public URL
yet (`bo.shos.hellfiresol.com` DNS not live — checked 2026-09-26), so there's a window to fix this
before real staff traffic exists.

## Task 1 (Medium) — open redirect in the post-login `?next=` handling

**Where:** `apps/backoffice/components/shell/LoginForm.tsx:52-53`:
```ts
const next = new URLSearchParams(window.location.search).get("next");
router.replace(next && next.startsWith("/") ? next : "/");
```
`"//evil.example".startsWith("/")` is `true`, and browsers resolve a `//`-prefixed URL as
`https://evil.example` (protocol-relative). A crafted link like
`https://bo.shos.hellfiresol.com/login?next=//attacker.example/phish` would redirect a freshly
authenticated staff member off-domain immediately after a successful `signInWithPassword` call — the
worst possible moment for a phishing redirect (right after they've proven they trust the page).

**Fix:** validate more strictly — reject anything starting with `//` or containing `:` before the
first `/`, or parse with `new URL(next, window.location.origin)` and compare `.origin` against the
current origin before using it. `apps/backoffice/lib/supabase/middleware.ts:38-41`'s own
`?next=` construction (server-side, from `request.nextUrl.pathname`) is not attacker-controlled and
does not need this fix — only the client-side read-back in `LoginForm.tsx` does.

## Task 2 (Medium) — no security headers

Same finding as the web app (`/memory/boots/proposed/S7-02-S3-web-security-headers.md`) but more
urgent here: the back-office has no `Content-Security-Policy`/`X-Frame-Options` set anywhere
(`apps/backoffice/next.config.ts` has no `headers()`), meaning the **staff admin panel can currently
be iframed by any origin** — a clickjacking risk on `/login` and every authenticated screen once this
app has a public URL. Add the same `headers()` block as proposed to S3, adapted for this app's own
Supabase project URL and any admin-specific needs (e.g. this app likely doesn't need
`frame-ancestors 'none'` relaxed for anything — it should never be embedded).

## Task 3 (Low, informational) — cookie flags rely on library defaults

`apps/backoffice/lib/supabase/middleware.ts` and `lib/supabase/server.ts` pass `@supabase/ssr`'s own
`options` straight through to `response.cookies.set(name, value, options)` without ever setting
`httpOnly`/`secure`/`sameSite` explicitly in this codebase. `@supabase/ssr`'s current defaults are
reasonable, but nothing here pins that behaviour or tests it — a future upstream version bump could
silently change cookie security with no local test catching it. Suggest explicitly setting
`{ httpOnly: true, secure: true, sameSite: "lax" }` in the `setAll` callbacks and pinning the
`@supabase/ssr` version, rather than relying implicitly on the library's current defaults.

## Coordination note (see S1's proposal too)

The four staff seed accounts share one published password (`apps/backend/README.md`). S4-01's own
proposal (`S1-04-backoffice-host.md`) already lists rotating it as a pre-condition before the public
URL goes live — S7 is reinforcing that this must happen before `bo.shos.hellfiresol.com` is announced,
not treating it as optional polish. Not S4's action item to execute (S1/owner), but S4 should not wire
up anything that assumes the current shared password is acceptable for real staff use.
