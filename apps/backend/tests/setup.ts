// Resolves Supabase URL + keys for the test run.
// Priority: env vars → `supabase status -o env` (local stack started with `supabase start`).
import { execSync } from "node:child_process";

function fromStatus(): Record<string, string> {
  try {
    const out = execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const vars: Record<string, string> = {};
    for (const line of out.split("\n")) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
      if (m) vars[m[1]] = m[2];
    }
    return vars;
  } catch {
    return {};
  }
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const s = fromStatus();
  process.env.SUPABASE_URL ??= s.API_URL;
  process.env.SUPABASE_ANON_KEY ??= s.ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= s.SERVICE_ROLE_KEY;
}

for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) throw new Error(`${k} not set and \`supabase status\` unavailable — run \`supabase start\` first`);
}

// [S2-09] agent_role.test.ts needs a direct Postgres connection (no PostgREST in front of it — the
// whole point of §9.1's ruling) to `SET ROLE agent` and exercise its grants, since `agent` has no
// password and is not a role PostgREST can ever authenticate as. `supabase status -o env`'s DB_URL
// is the local superuser connection string (ci.yml's own "Seed is idempotent" step already uses the
// same value via psql); resolving it here the same way as the three vars above means this file does
// not depend on ci.yml exporting anything extra for this test run. The plain local-CLI default
// covers a dev machine that hasn't run `supabase status` itself yet.
process.env.DB_URL ??= fromStatus().DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
