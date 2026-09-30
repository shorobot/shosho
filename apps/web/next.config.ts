import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image copies .next/standalone only (apps/web/Dockerfile).
  output: "standalone",
  // Monorepo: the standalone bundle needs the workspace root to trace files.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  reactStrictMode: true,
  poweredByHeader: false,
  // No image optimizer: sharp is not a dependency and the web container runs under a 96 MB limit on a
  // 512 MB slice (D-004, D-013) — optimising uploaded photos there is not affordable. `unoptimized`
  // means next/image emits the src unchanged, so `remotePatterns` is never consulted and cannot be
  // what silently blocks a photo; it is declared anyway so the config is correct the day an optimizer
  // becomes affordable. The rule that *can* block a remote photo is CSP `img-src` — see lib/csp.ts.
  images: {
    unoptimized: true,
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
  typescript: { tsconfigPath: "./tsconfig.json" },
};

export default nextConfig;
