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
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"

pnpm --filter @shosho/e2e test:e2e
```

`playwright.config.ts`'s `webServer` entries start both Next apps for you (reusing a server already
running on 3100/3102 outside CI). Stop the stack afterwards: `pnpm --filter @shosho/backend db:stop`.

**This machine (macOS 12 / Darwin 21.6.0) cannot install Playwright's chromium** — confirmed empirically
during this boot (`~/Library/Caches/ms-playwright` has no browser binary, matching S3/S4's own notes in
`memory/log.md`). The specs still typecheck and lint here; running them needs a Linux box or CI.

## Running against staging (manual only — never part of CI, and staging is shared)

Back-office has no public host yet (`memory/state.md`): reach it over the documented ssh tunnel
(`memory/infra-access.md`), and point the suite at `shosho-staging`'s public URL/anon key (ask S0/owner
for them — never commit them):

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
