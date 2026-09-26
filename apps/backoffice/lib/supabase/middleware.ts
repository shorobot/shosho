import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@shosho/backend/types/database";
import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/no-access", "/auth/signout"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Refreshes the auth cookies on every request and sends unauthenticated users to /login.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  if (!supabaseUrl || !supabaseAnonKey) return response; // unconfigured: pages render the setup hint

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
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
