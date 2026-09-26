// Public runtime configuration. The Docker image is built in CI without Supabase values, so the server
// reads plain env at request time (rendered into the container by apps/infra/_deploy.yml) and hands the
// public pair to the browser through <EnvProvider> in app/layout.tsx. Only the anon key ever leaves the
// server — the service-role key is not used by this app at all (RLS + staff session do the guarding).

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function publicEnv(): PublicEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
  };
}

export function isSupabaseConfigured(): boolean {
  const e = publicEnv();
  return Boolean(e.supabaseUrl && e.supabaseAnonKey);
}
