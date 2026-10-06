import type { NextRequest } from "next/server";
import { contentSecurityPolicy, isSecureContext, staticSecurityHeaders, supabaseSources } from "@/lib/csp";
import { updateSession } from "@/lib/supabase/middleware";

// Two jobs on every request: refresh the staff session, and set this app's own security headers
// (S7-01 finding 5). The rationale — and the `force-dynamic` precondition the nonce depends on — is in
// lib/csp.ts. Read that before changing anything here.
export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  // Loopback means the ssh tunnel into staging or `next dev`: no HSTS and no
  // upgrade-insecure-requests there. lib/csp.ts explains why each would misfire, and why this reads
  // the forwarded headers rather than `request.nextUrl.hostname` (which is always "localhost").
  const secureContext = isSecureContext(request.headers);
  const csp = contentSecurityPolicy(nonce, supabaseSources(), { upgradeInsecure: secureContext });

  // Next reads the CSP off the *request* headers and stamps the nonce onto the script tags it emits,
  // so the policy has to travel inbound as well as outbound.
  const response = await updateSession(request, { "x-nonce": nonce, "Content-Security-Policy": csp });

  response.headers.set("Content-Security-Policy", csp);
  for (const [key, value] of staticSecurityHeaders(secureContext)) response.headers.set(key, value);
  return response;
}

export const config = {
  // everything except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|sounds/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav)$).*)"],
};
