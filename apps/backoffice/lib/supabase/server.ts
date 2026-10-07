import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "@shosho/backend/types/database";
import { publicEnv } from "@/lib/env";
import { cookieFlags } from "@/lib/supabase/cookies";

// Server components / route handlers: session from cookies (@supabase/ssr). Cookie writes are attempted
// but may be ignored inside a server component — middleware.ts is the place that refreshes the session.
// They are *not* ignored in a route handler, which is why the flags are pinned here too: POST
// /auth/signout writes through this client (app/auth/signout/route.ts).
export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  // Same rule as the middleware (lib/supabase/cookies.ts), from the same header bag.
  const flags = cookieFlags(await headers());
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, { ...options, ...flags }));
        } catch {
          // called from a server component — middleware refreshes the session instead
        }
      },
    },
  });
}
