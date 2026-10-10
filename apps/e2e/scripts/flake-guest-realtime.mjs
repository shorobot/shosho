#!/usr/bin/env node
// Task 5: quantify apps/backend/tests/guest_realtime.test.ts's flake rate by actually running it N
// times against a live local Supabase stack, not by re-reading its determinism fix and trusting it.
// Needs: a running local Supabase (see apps/e2e/README.md) and apps/backend's own vitest installed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, "../../backend");
const runs = Number(process.env.RUNS ?? 25);

let pass = 0;
const failures = [];

for (let i = 1; i <= runs; i++) {
  const result = spawnSync("pnpm", ["exec", "vitest", "run", "tests/guest_realtime.test.ts"], {
    cwd: backendDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  const ok = result.status === 0;
  if (ok) pass++;
  else failures.push({ run: i, status: result.status, tail: (result.stdout + result.stderr).split("\n").slice(-25).join("\n") });
  process.stdout.write(`run ${i}/${runs}: ${ok ? "pass" : "FAIL"}\n`);
}

const rate = ((pass / runs) * 100).toFixed(1);
console.log(`\n${pass}/${runs} passed (${rate}%).`);
if (failures.length > 0) {
  console.log(`\n--- failure detail (last 25 lines of output, per failing run) ---`);
  for (const f of failures) console.log(`\n# run ${f.run} (exit ${f.status})\n${f.tail}`);
}
process.exitCode = failures.length > 0 && pass === 0 ? 1 : 0; // non-zero only if EVERY run failed — a genuine flake rate between 0 and 100% is the point of this script, not a CI gate
