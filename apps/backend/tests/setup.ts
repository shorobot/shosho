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
