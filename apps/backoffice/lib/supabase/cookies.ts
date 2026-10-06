// Session cookie flags, pinned here rather than inherited from the library (S7-01 task 3).
//
// `@supabase/ssr`'s defaults are reasonable, but nothing in this repo stated them and no test held
// them in place, so an upstream version bump could have quietly loosened the staff session cookie
// with nothing failing. `secure` and `sameSite` are now set explicitly at every server write site
// (lib/supabase/middleware.ts, lib/supabase/server.ts) and asserted in tests/security.test.ts.
//
// ---------------------------------------------------------------------------------------------------
// `HttpOnly` is deliberately NOT set, and that is a correction to S7-01 task 3 rather than an omission.
//
// S7 suggested `{ httpOnly: true, secure: true, sameSite: "lax" }`. The first of those cannot apply to
// this cookie, and setting it is actively harmful here. Measured, not assumed:
//
//   - `document.cookie` in the running back-office returns the `sb-<ref>-auth-token` cookie, so it is
//     not HttpOnly today whatever the server sends.
//   - The reason is `@supabase/ssr`'s **browser** client: with no `cookies` option it implements its
//     storage directly on `document.cookie` — reading it in `documentCookieGetAll` and writing it in
//     `documentCookieSetAll` (node_modules/@supabase/ssr/dist/main/cookies.js). `signInWithPassword`
//     runs in a client component (components/shell/LoginForm.tsx), so the browser writes the cookie,
//     and a cookie written through `document.cookie` cannot carry HttpOnly.
//   - This app reads its data from client components through that same browser client — the orders
//     board, the kitchen and driver screens, the CRM. All of it needs the access token to be readable
//     from JavaScript to attach it to PostgREST and realtime calls as the staff user.
//
// So a server-set HttpOnly cookie would not harden anything; it would **break the app on a delay**. At
// the first server-side token refresh the middleware would write a cookie the browser client can no
// longer see, the client would conclude there is no session, and every RLS-filtered client query would
// come back empty — a board and a customer list that silently go blank an hour into a shift while the
// user still appears signed in. Latent, intermittent, and very hard to attribute.
//
// Making the session genuinely HttpOnly is not a flag change: it needs the token to stop being read in
// the browser at all, i.e. moving every Supabase read behind server routes or server actions. That is
// an architecture decision for S0/S3/S4 together, not a line in this file. Filed to S7 (D-012) so the
// finding is corrected at the source rather than re-raised at the next audit.
//
// What actually defends this token against the XSS that HttpOnly is meant to blunt is the CSP added in
// the same boot: nonce-based, `strict-dynamic`, no `unsafe-inline` for scripts, `object-src 'none'`
// (lib/csp.ts). That is the control doing the work here.
// ---------------------------------------------------------------------------------------------------
//
// `Secure` is conditional, and that is deliberate:
//   - staging is reached over an ssh port-forward today (`ssh -L 8202:127.0.0.1:8202`), so the browser
//     sees `http://localhost:8202`. A `Secure` cookie is never sent back over that, which would make
//     sign-in loop forever with no visible error — the local recipe is in README.md.
//   - `next dev` has the same shape.
//   - everything else — `bo-shos.hellfiresol.com` through Cloudflare — gets `Secure`.
//
// The condition comes from `isSecureContext()` in lib/csp.ts, which fails closed: only a request it
// can positively identify as loopback loses the flag. Read the note there before changing it — the
// obvious implementation (`request.nextUrl.hostname`) is measurably wrong and silently downgrades
// production.
//
// Consequence worth knowing: `http://bo-shos.hellfiresol.com/` answers in cleartext today (no
// redirect — a hostname-scoped Cloudflare Redirect Rule is on the owner's list). A browser that
// reaches the app that way will not get a usable session, because the cookie it is handed is
// `Secure`. That is the correct posture, not a regression: the alternative is staff credentials and a
// session cookie crossing the wire in the clear.

import { isSecureContext } from "@/lib/csp";

export type CookieFlags = { secure: boolean; sameSite: "lax" };

/** The flags every server-side session-cookie write is forced to carry, for a request with these headers. */
export function cookieFlags(headers: { get(name: string): string | null }): CookieFlags {
  return { secure: isSecureContext(headers), sameSite: "lax" };
}
