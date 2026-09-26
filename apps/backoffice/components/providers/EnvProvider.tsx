"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PublicEnv } from "@/lib/env";
import { createClient, type Client } from "@/lib/supabase/client";

type Ctx = { env: PublicEnv; supabase: Client | null };

const EnvContext = createContext<Ctx>({ env: { supabaseUrl: "", supabaseAnonKey: "" }, supabase: null });

// Hands the server's runtime env to the browser bundle and builds the one browser Supabase client.
// Only public values cross this boundary: the anon key is public by design (RLS does the guarding).
export function EnvProvider({ env, children }: { env: PublicEnv; children: ReactNode }) {
  const value = useMemo<Ctx>(
    () => ({ env, supabase: env.supabaseUrl && env.supabaseAnonKey ? createClient(env.supabaseUrl, env.supabaseAnonKey) : null }),
    [env],
  );
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

export function useEnv() {
  return useContext(EnvContext).env;
}

/** The browser Supabase client. Throws when the app is unconfigured — pages guard with useEnv() first. */
export function useSupabase(): Client {
  const c = useContext(EnvContext).supabase;
  if (!c) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY)");
  return c;
}
