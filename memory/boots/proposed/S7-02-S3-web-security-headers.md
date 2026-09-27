# Proposal → S3 Frontend: security headers for apps/web

From S7 Security. Full context: `/docs/security.md` §5, `/memory/log.md` S7-01 entry.

## Finding (Medium)

`apps/web/next.config.ts` defines no `headers()` function, and no middleware or `<meta>` tag sets any
of the standard security headers. Verified against the live site
(`curl -sI https://shos.hellfiresol.com/`): Cloudflare/the app currently sends
`strict-transport-security: max-age=86400` (1 day — short), `x-content-type-options: nosniff`,
`x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin` — but these appear to be
Cloudflare defaults, not something this repo's code configures or can rely on continuing to send.
**Missing entirely:** `Content-Security-Policy`, `Permissions-Policy`, and a longer-lived
`Strict-Transport-Security` (with `includeSubDomains`/`preload` if the owner wants that).

## Suggested fix

Add a `headers()` function to `apps/web/next.config.ts` (Next.js supports this natively, no new
dependency):
```ts
async headers() {
  return [{
    source: "/:path*",
    headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      // CSP: start permissive enough for next/font + Supabase, then tighten — this app has no
      // analytics/third-party scripts today (verified), so a fairly strict default-src should work:
      { key: "Content-Security-Policy", value: "default-src 'self'; img-src 'self' data: https://bvmitglwwqsvufetlkff.supabase.co; connect-src 'self' https://bvmitglwwqsvufetlkff.supabase.co wss://bvmitglwwqsvufetlkff.supabase.co; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" },
    ],
  }];
},
```
Test carefully against the real Supabase project URL (env-driven, not hardcoded — the example above
hardcodes the staging ref for illustration only) and against the realtime websocket connection
(guest tracking, §3 of `docs/security.md`) before shipping — a too-strict `connect-src` will silently
break the tracking page's live updates and it will look like a Supabase outage, not a CSP block.

## Also worth a look

The tracking token (`/order/[token]`) already has no leak vector today (no third-party requests on
that page — verified) — but that's currently true only because there's no analytics/embeds. If any
future feature adds one, `Referrer-Policy: strict-origin-when-cross-origin` (or stricter) becomes
load-bearing, not just nice-to-have — worth keeping in mind before adding e.g. an embedded map or
analytics SDK to the tracking page specifically.
