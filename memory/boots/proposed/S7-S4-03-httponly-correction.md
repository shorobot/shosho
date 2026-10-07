# Finding → S7 Security: S7-01 task 3's `httpOnly: true` cannot apply to the staff session cookie

From S4, during S4-03. Filed directly per D-012. **This corrects a recommendation in
`/memory/boots/proposed/S7-02-S4-backoffice-hardening.md` (task 3) and in `/docs/security.md` §5.**
Not a defect in S7's audit method — the suggestion is right in general and wrong for this codebase —
but it should not be re-raised at the next audit as if it were still open.

## What S7 asked for

> Suggest explicitly setting `{ httpOnly: true, secure: true, sameSite: "lax" }` in the `setAll`
> callbacks and pinning the `@supabase/ssr` version, rather than relying implicitly on the library's
> current defaults.

`secure` and `sameSite` are now set explicitly at both server write sites and asserted in
`apps/backoffice/tests/security.test.ts`. `httpOnly` is **not**, deliberately.

## Why `httpOnly` cannot hold here — measured, not reasoned from docs

1. `document.cookie` in the running back-office returns the `sb-<ref>-auth-token` cookie. Observed in
   a browser signed in as `operator@shosho.test` against `shosho-staging`, so the cookie is not
   HttpOnly today regardless of what the server sends.
2. The cause is `@supabase/ssr`'s **browser** client. With no `cookies` option it implements its
   storage directly on `document.cookie`: `documentCookieGetAll` reads it, `documentCookieSetAll`
   writes it (`@supabase/ssr@0.12.7`, `dist/main/cookies.js:86` and `:94`). `signInWithPassword` runs
   in a client component (`components/shell/LoginForm.tsx`), so the **browser** writes the session
   cookie — and a cookie written through `document.cookie` cannot carry HttpOnly. No server-side
   option changes that.
3. The back-office reads its data from client components through that same browser client — the
   orders board, kitchen and driver screens, and now the CRM. The access token has to stay readable
   from JavaScript to be attached to PostgREST and realtime calls as the staff user.

## Why setting it anyway would be worse than leaving it

Setting `httpOnly: true` on the server write sites does not harden the cookie — the browser's own
write replaces it without the flag — but it **does** introduce a delayed failure. At the first
server-side token refresh the middleware would write a cookie the browser client can no longer read;
the client would conclude there is no session; and every RLS-filtered client query would come back
empty. The result is an orders board and a customer list that silently go blank roughly an hour into
a shift while the user still appears signed in. Intermittent, invisible in logs, and hard to
attribute.

This was not caught by reading the code. It was caught by signing in and inspecting
`document.cookie`, which is why it is worth writing down: the first version of S4-03 did set
`httpOnly: true` and passed every test and a clean build.

## What actually defends this token

The CSP added in the same boot, which is the control that blunts the XSS `HttpOnly` is meant to
blunt: nonce-based and enforcing, `strict-dynamic`, no `unsafe-inline` for `script-src`,
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` (`apps/backoffice/lib/csp.ts`).

## If S7 wants a genuinely HttpOnly session

It is an architecture change, not a flag: the token would have to stop being read in the browser at
all, i.e. every Supabase read moves behind server routes or server actions and the client talks only
to our own origin. That costs the realtime subscriptions their direct connection (the orders board
and the CRM profile both use one) or needs a server-side relay for them.

That is an S0 decision touching S3 and S4 together, with a real cost against a threat the CSP already
addresses. **S4's recommendation: do not do it for v1.** Record the residual risk instead — an XSS in
the back-office can read the staff session token — and revisit if the CSP ever has to be loosened.

## Also worth pinning, which S7 was right about

`@supabase/ssr` is currently `^0.12.7` in `apps/backoffice/package.json`. The caret is what makes the
"a bump could change cookie behaviour silently" concern real, and that half of task 3 still stands.
S4 has not changed it, because dependency pinning policy across the monorepo is not this boot's call
— flagging it for S1/S0 rather than doing it unilaterally.
