import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@shosho/backend/types/database";
import { publicEnv } from "@/lib/env";

// Server components / route handlers: session from cookies (@supabase/ssr). Cookie writes are attempted
// but may be ignored inside a server component — middleware.ts is the place that refreshes the session.
export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a server component — middleware refreshes the session instead
        }
      },
    },
  });
}
