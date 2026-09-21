// Runs the real Supabase contract through lib/api-supabase.ts. Needs a running Supabase
// (local `supabase start` or any project) via NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@shosho/backend/types/database": fileURLToPath(new URL("../backend/types/database.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
