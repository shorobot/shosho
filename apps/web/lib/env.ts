// Public runtime configuration. NEXT_PUBLIC_* values are inlined at build time by Next.js, but the
// Docker image is built in CI without the Supabase secrets — so the server also reads plain env at
// runtime (rendered into the container by apps/infra/_deploy.yml) and hands the values to the browser
// through <PublicEnvScript /> in app/layout.tsx. Client code reads window.__SHOSHO_ENV__ first.

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
  apiMode: "supabase" | "mock";
};

declare global {
  interface Window {
    __SHOSHO_ENV__?: Partial<PublicEnv>;
  }
}

function fromProcess(): PublicEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    apiMode: process.env.NEXT_PUBLIC_API === "mock" ? "mock" : "supabase",
  };
}

export function publicEnv(): PublicEnv {
  if (typeof window !== "undefined" && window.__SHOSHO_ENV__) {
    const w = window.__SHOSHO_ENV__;
    const p = fromProcess();
    return {
      supabaseUrl: w.supabaseUrl || p.supabaseUrl,
      supabaseAnonKey: w.supabaseAnonKey || p.supabaseAnonKey,
      siteUrl: w.siteUrl || p.siteUrl,
      apiMode: w.apiMode ?? p.apiMode,
    };
  }
  return fromProcess();
}

export function isSupabaseConfigured(): boolean {
  const e = publicEnv();
  return Boolean(e.supabaseUrl && e.supabaseAnonKey);
}
