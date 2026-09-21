import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image copies .next/standalone only (apps/web/Dockerfile).
  output: "standalone",
  // Monorepo: the standalone bundle needs the workspace root to trace files.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  reactStrictMode: true,
  poweredByHeader: false,
  // No image optimizer (sharp) in the 96 MB container; photos are placeholder art in v1 anyway.
  images: { unoptimized: true },
  typescript: { tsconfigPath: "./tsconfig.json" },
};

export default nextConfig;
