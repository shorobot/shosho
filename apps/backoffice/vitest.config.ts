import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@shosho/backend/types/database": fileURLToPath(new URL("../backend/types/database.ts", import.meta.url)),
    },
  },
  // The guard tests call the real page/layout server components, which construct JSX. Next's
  // tsconfig keeps `jsx: "preserve"` for its own compiler, so esbuild is told the runtime here —
  // test-only, and the existing pure-logic suites are unaffected.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
