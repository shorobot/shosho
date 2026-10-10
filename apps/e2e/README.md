# SHOSHO — cross-app end-to-end (S6-01)

Owner: **S6 QA**. Playwright specs that drive `apps/web` and `apps/backoffice` together against one
Supabase (local stack or `shosho-staging`) — the independent, cross-session check that no single
app's own test suite can express. Contract: [`/docs/api-contracts.md`](../../docs/api-contracts.md),
product rules: [`/docs/design/README.md`](../../docs/design/README.md).

```
apps/e2e/
├── playwright.config.ts   starts apps/web (port 3100) and apps/backoffice (port 3102) dev servers
├── fixtures.ts            webPage / boPage (two browser contexts, two apps), db (owner session),
│                           anonDb, signInBackoffice(page, role)
├── helpers/
│   ├── db.ts               anon()/signInAs(role) — NEVER the service-role key, see "Boundaries" below
│   └── money.ts             parses "14.90 €" / "34,50 €" / "€34.50" back to integer cents
├── specs/                  one file per journey or seam (see each file's header comment)
└── scripts/
    └── flake-guest-realtime.mjs   runs apps/backend's guest_realtime.test.ts N times, reports the rate
```

## Why a new package, not `apps/web/e2e` or `apps/backoffice/e2e`

Both already exist and both stay as they are — `apps/web/e2e` runs against the **mock** API only (no
Supabase, single app); `apps/backoffice/e2e` runs against a **real** Supabase but only ever drives that
one app. Neither can express "a guest places a real order on the web app → it shows up on the
back-office board against the same database → an operator drives it → the guest's tracking page
updates" — the shape of every scenario this suite exists for. `apps/e2e` runs both dev servers under
one Playwright config and adds a thin DB helper for the assertions neither UI can show on its own
(comparing a rendered total against `quote_order`'s own response, say).

## Running locally (needs Docker, for the local Supabase stack)

```bash
pnpm install
pnpm --filter @shosho/backend db:start          # local Supabase: migrations + seed
pnpm --filter @shosho/e2e install:browsers       # chromium — see "macOS 12" note below

status=$(pnpm --filter @shosho/backend exec supabase status -o env | sed 's/^/export /')
eval "$status"
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"

# S2-05: seed.sql gives every staff account a random password on purpose. This sets the documented
# LOCAL-ONLY one ("local-dev-only") that helpers/db.ts's signInAs() expects — refuses anything but a
# loopback Supabase URL, so it's safe to run every time. (apps/backend's own `pnpm test` does this
# automatically via its `pretest` hook; this suite doesn't run that, so it's explicit here instead.)
pnpm --filter @shosho/backend run seed:local-logins

pnpm --filter @shosho/e2e test:e2e
```

`playwright.config.ts`'s `webServer` entries start both Next apps for you (reusing a server already
running on 3100/3102 outside CI). Stop the stack afterwards: `pnpm --filter @shosho/backend db:stop`.

**This machine cannot run any of the above** — confirmed empirically during this boot, not assumed:
`pnpm exec playwright install chromium` fails outright (`ERROR: Playwright does not support chromium on
mac12`, matching S3/S4's own notes in `memory/log.md`), and `colima start` fails before Docker even
comes up (`qemu-img not found` — the host has no qemu and installing one is outside this boot's scope).
The specs typecheck and `playwright test --list` cleanly here (32 tests across 12 files); actually
running them needs a Linux box, a Mac with Docker already working, or CI.

## Running against staging (manual only — never part of CI, and staging is shared)

The back-office has a public hostname now (`https://bo-shos.hellfiresol.com/`) but it sits behind
Cloudflare Access/basic-auth and the staff login password is mid-rotation (`memory/state.md` — the
owner may rotate `shosho-test-2026` at any moment, after which only they hold the new value) — so the
ssh tunnel (`memory/infra-access.md`) stays the practical way in for now. Point the suite at
`shosho-staging`'s public URL/anon key (ask S0/owner — never commit them) and `E2E_PASSWORD` if the
staging password has already been rotated by the time you run this:

```bash
ssh -N -L 8202:127.0.0.1:8202 shos@164.90.235.66 -i ~/.ssh/shos_ed25519 &
export WEB_URL=https://shos.hellfiresol.com
export BO_URL=http://127.0.0.1:8202
export SUPABASE_URL=... SUPABASE_ANON_KEY=...
export NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
pnpm --filter @shosho/e2e exec playwright test --config playwright.config.ts # webServer still starts local dev servers pointed at staging's DB — nothing here deploys to or reseeds staging
```

Clean up any test order/category this creates on staging the same way S4-02 did (delete it afterwards);
never truncate or reseed the shared project.

## Flaky-test flake rate

```bash
pnpm --filter @shosho/e2e flake:guest-realtime            # defaults to 25 runs
RUNS=50 pnpm --filter @shosho/e2e flake:guest-realtime
```

Needs a running local Supabase (same env as above) and `apps/backend`'s own devDependencies (vitest).
Report: `memory/log.md`'s S6-01 entry.

## Boundaries (from the boot, restated for whoever edits this package next)

- **Never the service-role key**, anywhere, for any reason — setup and assertions go through a real
  `owner`-signed-in session (`db` fixture) or the anon key (`anonDb`), exactly like a human would. RLS
  is the thing half of this suite is here to check; bypassing it defeats the point.
- Don't modify `apps/web`, `apps/backoffice`, `apps/backend`, or `apps/infra` — tests and proposals
  only. A missing `data-testid` is proposed in `/memory/boots/proposed/`, not added here.
- Don't reseed, truncate, or reset `shosho-staging`; don't delete another session's orders; clean up
  your own test data where you can (seeded ids in `helpers/db.ts` are read-only fixtures — never
  mutated in place; disposable test rows get their own id and are deleted in a `finally`).
