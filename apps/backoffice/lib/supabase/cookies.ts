// Session cookie flags, pinned here rather than inherited from the library (S7-01 task 3).
//
// `@supabase/ssr`'s current defaults are reasonable, but nothing in this repo stated them and no test
// held them in place, so an upstream version bump could have quietly loosened the staff session
// cookie with nothing failing. These three flags are now set explicitly at every write site
// (lib/supabase/middleware.ts, lib/supabase/server.ts) and asserted in tests/security.test.ts.
//
// `Secure` is conditional, and that is deliberate rather than a compromise:
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

export type CookieFlags = { httpOnly: true; secure: boolean; sameSite: "lax" };

/** The flags every session-cookie write is forced to carry, for a request with these headers. */
export function cookieFlags(headers: { get(name: string): string | null }): CookieFlags {
  return { httpOnly: true, secure: isSecureContext(headers), sameSite: "lax" };
}
