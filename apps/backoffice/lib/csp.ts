// Security headers the back-office serves itself (S7-01 finding 5, /docs/security.md §5). Until now
// nothing in this app set them: `next.config.ts` has no `headers()` and `middleware.ts` only
// refreshed the session, so the staff admin panel was **iframe-able by any origin** — clickjacking on
// /login and on every authenticated screen. Whatever Cloudflare happened to add in front was not ours
// and could be taken away by a dashboard change nobody here would see.
//
// ---------------------------------------------------------------------------------------------------
// CSP is nonce-based and **enforcing**, the same choice apps/web made. Read this before changing it.
//
// That is only safe because `app/layout.tsx` sets `export const dynamic = "force-dynamic"`, so every
// HTML response is rendered per request and the nonce in the header always matches the markup. If any
// route here becomes static or ISR, its cached HTML carries a stale nonce and every script on the page
// is blocked with no useful error.
//
// The back-office has a second, independent reason for that `force-dynamic` which the guest site does
// not have: the Docker image is built in CI **without** Supabase values, so `publicEnv()` has to be
// read at request time (lib/env.ts). Per-request rendering is therefore load-bearing for the app to
// function at all, not only for the nonce — which is why a nonce CSP was chosen here rather than the
// hash/'self' alternative. The constraint is deliberate and doubly anchored, but it is still a
// constraint: **do not make a route under app/ static.**
// ---------------------------------------------------------------------------------------------------
//
// What this app actually loads:
//   scripts  — Next's own bundles and its inline bootstrap. All nonced; 'strict-dynamic' lets the
//              nonced loader pull the chunk files. There is no custom inline script: runtime env
//              reaches the browser as props through <EnvProvider>, not through a script tag.
//   styles   — Tailwind via a stylesheet, plus React `style={{…}}` attributes (Shell's kitchen-load
//              bar, the print receipt in components/detail/Bon.tsx) → 'unsafe-inline' is load-bearing
//              for style-src.
//   fonts    — next/font/google self-hosts Archivo and Zen Kaku at build time under /_next/static,
//              so 'self' is enough and no Google host is needed at runtime.
//   images   — the `menu` bucket on Supabase (menu photos), plus `blob:` for the local preview of a
//              file being uploaded (components/menu/Photos.tsx) and `data:` URIs.
//   connect  — Supabase REST/RPC over https and Realtime over wss (the orders board, and the
//              customer profile's `customer_events` subscription). A too-strict connect-src looks
//              like a Supabase outage rather than a CSP block.
//   media    — none: the new-order chime is synthesised with WebAudio, no asset is fetched
//              (lib/sound.ts), so 'self' is as wide as this needs to be.

import { publicEnv } from "@/lib/env";

/**
 * True for a loopback host. Three things must not be sent over the ssh tunnel that is the only way
 * into staging today (`ssh -L 8202:127.0.0.1:8202`, so the browser sees http://localhost:8202):
 *
 *   - **HSTS** — `includeSubDomains` on `localhost` would pin *every* localhost port to https in that
 *     browser profile, breaking this app's own `next dev` and every other local dev server. A real
 *     foot-gun, and one that outlives the session that caused it.
 *   - **upgrade-insecure-requests** — would rewrite same-origin http requests to https://localhost:8202,
 *     where nothing is listening.
 *   - **a `Secure` session cookie** — never sent back over the tunnel's http, so sign-in would loop
 *     forever with no visible error (lib/supabase/cookies.ts).
 *
 * Production (`bo-shos.hellfiresol.com`) is not loopback and gets all three.
 */
export function isLoopbackHost(hostname: string | null | undefined): boolean {
  const h = (hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}

/**
 * The host as the browser sees it, port stripped.
 *
 * **Do not use `request.nextUrl.hostname` for this.** Measured on Next 15.5.25: it is `localhost`
 * on every request regardless of the `Host` header, because it reflects the server's own listening
 * address. Keying the `Secure` cookie flag on it marks *production* as loopback — the exact
 * fail-open this function exists to prevent.
 */
export function externalHost(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-host");
  const raw = (forwarded && forwarded.trim() ? forwarded : headers.get("host")) ?? "";
  // A proxy chain sends a comma-separated list; the first entry is the client-facing one.
  const first = raw.split(",")[0]!.trim();
  // Strip the port without mangling a bare IPv6 literal (`::1` has colons but no port).
  if (first.startsWith("[")) return first.slice(0, first.indexOf("]") + 1);
  return first.split(":").length === 2 ? first.split(":")[0]! : first;
}

/**
 * Whether this request reached us over a secure public hop — the one input behind HSTS,
 * `upgrade-insecure-requests` and the `Secure` cookie flag.
 *
 * It **fails closed**: every branch that cannot prove loopback answers `true`. That direction matters,
 * because a wrong `false` in production would put a staff session cookie on the wire in cleartext,
 * while a wrong `true` only costs a sign-in loop in local development, where the cause is obvious.
 *
 * `X-Forwarded-*` presence is not itself a proxy signal: Next synthesises both headers from the
 * connection when a proxy did not send them (measured — a direct `curl` still yields
 * `x-forwarded-proto: http`). Their *values* are what carry information, so they are read, not
 * merely tested for existence.
 *
 * Residual gap, stated rather than papered over: a proxy that forwards neither the original `Host`
 * nor `X-Forwarded-Proto` nor any `CF-*` header is indistinguishable from the ssh tunnel from inside
 * this container, and would be treated as loopback. Closing that needs a deployment-set env var, and
 * `apps/infra` is outside this session's boundary (D-004) — the container receives only the two
 * Supabase variables today. Production arrives through Cloudflare, so the `CF-*` branch covers it.
 */
export function isSecureContext(headers: { get(name: string): string | null }): boolean {
  // Arrived through Cloudflare, so the public hop was https whatever the internal hop looks like.
  if (headers.get("cf-ray") || headers.get("cf-connecting-ip")) return true;
  const proto = (headers.get("x-forwarded-proto") ?? "").split(",")[0]!.trim().toLowerCase();
  if (proto === "https") return true;
  return !isLoopbackHost(externalHost(headers));
}

/** The Supabase project origin, or null when the server has no URL configured. */
export function supabaseOrigin(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Supabase origins for `img-src`/`connect-src`. The exact project origin when the runtime env has it;
 * otherwise the `*.supabase.co` wildcard, so a missing env degrades to "any Supabase project" rather
 * than to a back-office that cannot reach its own database.
 */
export function supabaseSources(): { http: string; ws: string } {
  const origin = supabaseOrigin(publicEnv().supabaseUrl);
  if (!origin) return { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
  return { http: origin, ws: origin.replace(/^https:/, "wss:") };
}

export function contentSecurityPolicy(nonce: string, sb: { http: string; ws: string }, opts: { upgradeInsecure: boolean }): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // The back-office must never be embedded — it is the clickjacking fix, not a nicety.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${sb.http}`,
    `connect-src 'self' ${sb.http} ${sb.ws}`,
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (opts.upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * Everything that does not depend on the nonce. `secureContext` is false on loopback — see
 * `isLoopbackHost` for why HSTS in particular must not be sent there.
 *
 * Note on HSTS: TETA+PI's nginx already sends `Strict-Transport-Security: max-age=86400` in front of
 * this app, so on `bo-shos.hellfiresol.com` the header appears **twice** once this one is added. Per
 * RFC 6797 §8.1 a user agent processes only the first, so it is a duplicate-header smell rather than a
 * bug. It is logged for S1/S7 to settle with TETA+PI and is explicitly not this app's to fix — the
 * host is S1's boundary (D-004).
 */
export function staticSecurityHeaders(secureContext: boolean): [string, string][] {
  const headers: [string, string][] = [
    ["X-Content-Type-Options", "nosniff"],
    // frame-ancestors above is the modern rule; this is for browsers that do not honour it.
    ["X-Frame-Options", "DENY"],
    // Customer and order ids sit in back-office paths (/customers/<id>, /orders/<id>). Nothing on
    // these screens makes a third-party request, so withholding the referrer outright costs nothing
    // and keeps those ids out of any future outbound hop (the only external link is the storefront
    // preview on the menu screen, which has no use for a referrer).
    ["Referrer-Policy", "no-referrer"],
    ["Permissions-Policy", "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"],
  ];
  if (secureContext) {
    // One year, subdomains included. `preload` is deliberately absent: submitting to the HSTS preload
    // list is the owner's call for the whole zone, not this app's, and it cannot be undone quickly.
    headers.push(["Strict-Transport-Security", "max-age=31536000; includeSubDomains"]);
  }
  return headers;
}
