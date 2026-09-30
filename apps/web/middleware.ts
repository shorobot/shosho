import { NextResponse, type NextRequest } from "next/server";
import { STATIC_SECURITY_HEADERS, contentSecurityPolicy, referrerPolicyFor, supabaseSources } from "@/lib/csp";

// Security headers for every response (S7-01 finding 5). The rationale, and the force-dynamic
// precondition the nonce depends on, are in lib/csp.ts — read that before changing anything here.
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, supabaseSources(process.env));

  // Next reads the CSP off the *request* headers and stamps the nonce onto the script tags it emits;
  // <PublicEnvScript /> reads `x-nonce` for the same reason (components/site/PublicEnvScript.tsx).
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", referrerPolicyFor(request.nextUrl.pathname));
  for (const [key, value] of STATIC_SECURITY_HEADERS) response.headers.set(key, value);
  return response;
}

export const config = {
  // Everything the browser renders. Build output under /_next/static is immutable and carries no
  // markup, so it is skipped to keep the middleware off the static asset path.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
