import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@shosho/backend/types/database";
import { publicEnv } from "@/lib/env";
import { cookieFlags } from "@/lib/supabase/cookies";

const PUBLIC_PATHS = ["/login", "/no-access", "/auth/signout"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Refreshes the auth cookies on every request and sends unauthenticated users to /login.
 *
 * `extraRequestHeaders` are merged into the headers the downstream render sees — middleware.ts uses it
 * to pass the per-request CSP nonce, which Next reads off the *request* to stamp onto its own script
 * tags. Every response built here has to carry them, which is why construction sits in one helper
 * rather than being inlined twice.
 */
export async function updateSession(request: NextRequest, extraRequestHeaders: Record<string, string> = {}) {
  // Headers for the downstream render. `setAll` below writes to `request.cookies` when Supabase rotates
  // a token, so the cookie header is re-serialised from it explicitly (`toString()`) rather than
  // relying on that mutation writing through to `request.headers`. A server component in this same
  // pass then reads the refreshed session instead of the one that just expired.
  const nextResponse = () => {
    const headers = new Headers(request.headers);
    const cookie = request.cookies.toString();
    if (cookie) headers.set("cookie", cookie);
    for (const [k, v] of Object.entries(extraRequestHeaders)) headers.set(k, v);
    return NextResponse.next({ request: { headers } });
  };

  let response = nextResponse();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  if (!supabaseUrl || !supabaseAnonKey) return response; // unconfigured: pages render the setup hint

  // Forced on every write rather than taken from @supabase/ssr's defaults — see cookies.ts.
  const flags = cookieFlags(request.headers);

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = nextResponse();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, ...flags }));
      },
    },
  });

  // getUser() validates the JWT against Auth (do not trust getSession() in middleware).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Built server-side from our own pathname, so this value is not attacker-controlled. The
    // read-back in components/shell/LoginForm.tsx is the half that has to validate — lib/safeRedirect.ts.
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
