// Security headers the app serves itself (S7-01 finding 5, /docs/security.md §5). Until now the
// headers on https://shos.hellfiresol.com/ came from Cloudflare defaults — nothing in this repo set
// them, so a CDN or proxy change would have taken them away silently. These are set in middleware.ts
// on every response, so they survive the edge.
//
// CSP is nonce-based and **enforcing**. That is only safe because the root layout is
// `dynamic = "force-dynamic"` (app/layout.tsx): every HTML response is rendered per request, so the
// nonce in the header always matches the one in the markup. If a page is ever made static or ISR,
// the cached HTML would carry a stale nonce and every script would be blocked — read this note first.
//
// Anything the guest site actually loads:
//   scripts  — Next's own bundles and its inline bootstrap, plus <PublicEnvScript />. All nonced;
//              'strict-dynamic' lets the nonced loader pull the chunk files.
//   styles   — Tailwind via a stylesheet, plus React `style={{…}}` attributes (CategoryIcon, Logo,
//              FreeDeliveryBar) → 'unsafe-inline' is load-bearing for style-src.
//   fonts    — next/font/google self-hosts Archivo and Zen Kaku at build time under /_next/static,
//              so 'self' is enough and no Google host is needed at runtime.
//   images   — the `menu` bucket on Supabase (lib/photos.ts) and inline data: URIs.
//   connect  — Supabase REST/RPC over https and Realtime over wss (guest tracking, security.md §3).
//              A too-strict connect-src breaks the tracking page's live updates and looks like a
//              Supabase outage, not a CSP block.

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
 * than to a blank menu. `NEXT_PUBLIC_*` is inlined at build time and the image is built without the
 * secrets (lib/env.ts), so `SUPABASE_URL` — set on the container by apps/infra — is read first.
 */
export function supabaseSources(env: Record<string, string | undefined>): { http: string; ws: string } {
  const origin = supabaseOrigin(env.SUPABASE_URL) ?? supabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!origin) return { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
  return { http: origin, ws: origin.replace(/^https:/, "wss:") };
}

/**
 * S6-01 finding 0 (HIGH, filed in `S6-02-S3-guest-tracking-realtime.md`; re-filed by S0 in
 * `S6-finding-0-csp-dev-carveout.md` after it went untasked, then narrowed to S3 and pre-approved in
 * `plan.md` 2026-10-22): `next dev`'s webpack HMR runtime evaluates chunks via `eval()`, which a CSP
 * with no `'unsafe-eval'` blocks outright — not as a timing race, as total: the server-rendered HTML
 * paints normally, but no client JavaScript executes at all, anywhere on the page. `next build`/
 * `next start` (what `shosho-staging` actually runs) never calls `eval()`, so this is completely
 * invisible in production — confirmed live on the deployed site in the same report. The carve-out is
 * therefore scoped to non-production only; the production CSP below is byte-for-byte unchanged.
 * Mirrors `apps/backoffice/lib/csp.ts`'s identical `scriptSrc` exactly — same bug, same shape.
 */
function scriptSrc(nonce: string): string {
  const base = `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return process.env.NODE_ENV === "production" ? `script-src ${base}` : `script-src ${base} 'unsafe-eval'`;
}

export function contentSecurityPolicy(nonce: string, sb: { http: string; ws: string }): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    scriptSrc(nonce),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${sb.http}`,
    `connect-src 'self' ${sb.http} ${sb.ws}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Everything that is the same on every response. `Referrer-Policy` is per-route — see below. */
export const STATIC_SECURITY_HEADERS: [string, string][] = [
  // One year, subdomains included. `preload` is deliberately absent: submitting the apex to the HSTS
  // preload list is the owner's call, not the storefront's, and it cannot be undone quickly.
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"],
  ["X-Content-Type-Options", "nosniff"],
  // frame-ancestors above is the modern rule; this is for browsers that do not honour it.
  ["X-Frame-Options", "DENY"],
  ["Permissions-Policy", "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"],
];

/**
 * The tracking token lives in the path (`/order/<token>`), so any outbound navigation from that page
 * would put it in a `Referer` header (S7-01 finding 8). There is no third-party request on that page
 * today; `no-referrer` makes that structural rather than incidental.
 */
export function referrerPolicyFor(pathname: string): string {
  return pathname === "/order" || pathname.startsWith("/order/") ? "no-referrer" : "strict-origin-when-cross-origin";
}
