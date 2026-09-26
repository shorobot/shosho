"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@shosho/backend/types/database";

export type Client = SupabaseClient<Database>;

let cached: Client | null = null;

// Browser client (one per tab). Realtime + RPC calls from client components go through it; the auth
// token comes from the same cookies the server set, so RLS sees the staff user.
export function createClient(url: string, anonKey: string): Client {
  if (cached) return cached;
  cached = createBrowserClient<Database>(url, anonKey);
  return cached;
}
