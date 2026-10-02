#!/usr/bin/env node
// [S2-05] Sets the documented LOCAL-ONLY password on the four seed staff accounts.
//
// Why this exists: `supabase/seed.sql` gives every staff account a random, immediately-discarded
// password, so a fresh or reset cloud project is never born with a password anyone can find in this
// public repo (the bug this boot fixes). Local development still wants a known, convenient login —
// this script is where that convenience lives, kept entirely out of SQL and out of version control.
//
// Run automatically by `pnpm test` (see package.json's `pretest`), after `supabase start` + `db
// reset` have created the four accounts. Also runnable by hand: `pnpm run seed:local-logins`.
//
// SAFETY: this script refuses to run against anything but a loopback Supabase URL. It exists to set
// a KNOWN password — the one thing seed.sql now deliberately avoids on a real project — so it must
// never be pointed at staging or any other real project, by accident or otherwise. There is no
// override flag; if you need that, you want scripts/rotate-staging-passwords.mjs instead.
//
// LOCAL_PASSWORD is duplicated in tests/helpers.ts (same literal, same reasoning there) rather than
// shared via import — the two files have different module systems and the value is not a secret, so
// a plain duplicate with a cross-reference comment is simpler than a build step for one string.
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const LOCAL_PASSWORD = "local-dev-only"; // keep in sync with tests/helpers.ts

const STAFF = [
  { id: "10000000-0000-4000-8000-000000000001", email: "owner@shosho.test" },
  { id: "10000000-0000-4000-8000-000000000002", email: "operator@shosho.test" },
  { id: "10000000-0000-4000-8000-000000000003", email: "kitchen@shosho.test" },
  { id: "10000000-0000-4000-8000-000000000004", email: "driver@shosho.test" },
];

// Same resolution order as tests/setup.ts: env vars first, then the running local stack's own
// `supabase status`. Duplicated rather than imported for the same reason as LOCAL_PASSWORD above.
function fromStatus() {
  try {
    const out = execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const vars = {};
    for (const line of out.split("\n")) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
      if (m) vars[m[1]] = m[2];
    }
    return vars;
  } catch {
    return {};
  }
}

const status = fromStatus();
const url = process.env.SUPABASE_URL ?? status.API_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "seed-local-logins: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set and `supabase status` " +
      "unavailable — run `supabase start` first.",
  );
  process.exit(1);
}

let hostname;
try {
  hostname = new URL(url).hostname;
} catch {
  console.error(`seed-local-logins: SUPABASE_URL is not a valid URL: ${url}`);
  process.exit(1);
}
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (!LOOPBACK.has(hostname)) {
  console.error(
    `seed-local-logins: refusing to run against ${hostname} — this script sets a KNOWN password ` +
      "and only ever runs against a loopback (local) Supabase stack. " +
      "For staging, use scripts/rotate-staging-passwords.mjs instead.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let failed = false;
for (const { id, email } of STAFF) {
  const { error } = await admin.auth.admin.updateUserById(id, { password: LOCAL_PASSWORD });
  if (error) {
    failed = true;
    console.error(`seed-local-logins: ${email} (${id}): ${error.message}`);
  }
}
if (failed) {
  console.error(
    "seed-local-logins: one or more accounts could not be updated — has `supabase db reset` run yet?",
  );
  process.exit(1);
}

console.log(`seed-local-logins: set the local-dev password on ${STAFF.length} staff accounts.`);
console.log(`  password: ${LOCAL_PASSWORD}  (local Supabase only — see apps/backend/README.md)`);
