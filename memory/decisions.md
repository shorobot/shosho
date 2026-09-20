# DECISIONS — architecture decisions

Format: `D-NNN — title` / Status / Decision / Why / Consequences. Decisions are never rewritten — a change is a new entry referencing the old one. Edited ONLY by S0.

---

## D-001 — Technology stack
Status: accepted 2026-09-17 (owner + S0). Amended by D-007.
Decision:
- DB / auth / realtime: **Supabase** (Postgres, RLS, Realtime)
- Guest site + ordering + back-office: **Next.js** (App Router, TypeScript)
- AI agents: **Claude Agent SDK**
- ~~Agent orchestration / integrations: n8n~~ — dropped, see D-007
- External integrations (Lieferando / Wolt / social webhooks): **FastAPI**
Why: realtime out of the box for the operator screen; one Postgres for every layer; agents work on the same DB without a separate bus.
Consequences: all sessions write to the same Supabase schema; contracts between layers = tables + RLS + REST/RPC, documented in /docs/api-contracts.md.

## D-002 — Project memory lives in git
Status: accepted 2026-09-17
Decision: `/memory` in the main repo is the single source of truth. Every session reads state.md + decisions.md before starting and writes to log.md after.
Why: Claude session context gets cut; files in git do not.
Consequences: every commit prefixed `[S<N>-<NN>]` (see /memory/sessions.md). S0 is the only one editing decisions.md and the state.md table as a whole; child sessions edit only their own row and log.md.

## D-003 — Sequential start, one active boot per session
Status: accepted 2026-09-17
Decision: S1 → S2 → S3 → S4, then S5 ‖ S6 ‖ S7 in parallel. At most one open boot per session.
Why: each layer depends on the previous layer's contracts; parallel edits of one contract without coordination break the system.
Consequences: a shared-contract change (API, DB schema) goes only through S0, who updates /docs/api-contracts.md and issues boots to both sides.

## D-004 — Hosting / server
Status: **accepted 2026-09-20** (owner). Supersedes S1's proposal of 2026-09-18 (`boots/proposed/decision-D-004.md`, kept for history).
Decision: staging runs as an **isolated co-tenant on the owner's existing shared DigitalOcean droplet** (Frankfurt) under the terms set by the TETA+PI manager — user `shos`, `/home/shos` only, 512M RAM hard cap, ports `127.0.0.1:8200–8299`, rootless docker or `systemd --user`, no sudo, no nginx access. Domain `shos.hellfiresol.com` is provided. Full terms: `/memory/infra-access.md`.
Why: zero extra cost, EU data, server already exists. The 512M cap is workable once n8n is out (D-007): web + api placeholders fit in ~150–250M.
Consequences: S1's infra assumptions (deploy user `shosho`, `/opt/shosho`, host nginx edits, root bootstrap, certbot/sslip.io) are obsolete and must be removed (S1-02). Any infra change on the host = request to `teta-pi-e0`. Prod is NOT on this box — separate decision after S7-01. If SHOSHO needs more than 512M later → request to TETA+PI or a dedicated droplet (owner decides).

## D-005 — Environments
Status: accepted 2026-09-17
Decision: two environments — `staging` (branch `main`, auto-deploy) and `prod` (git tag `v*`, manual approve). Local dev — `.env.local` + Supabase local or a separate dev Supabase project.
Why: a team of AI sessions makes many small commits; prod must not break on each one.
Consequences: S1 sets up both pipelines; S7 Security reviews the prod deploy before every tag.

## D-006 — Repository language is English
Status: accepted (owner instruction 2026-09-18 via S1; applied by S0 2026-09-20)
Decision: everything committed to the repo is in English — code, comments, commits, `/memory`, `/docs`, boots, proposals, READMEs, UI placeholders. Ukrainian only in chat.
Why: readable for any contributor, tool or model; no mixed-language drift between sessions.
Consequences: log entries written before 2026-09-20 stay in Ukrainian (history is not rewritten). Every new boot is issued in English.

## D-007 — n8n dropped from the stack
Status: accepted 2026-09-20 (owner)
Decision: n8n is removed from D-001. Agent orchestration, schedules and webhooks are implemented in code: FastAPI (webhooks, HTTP), Claude Agent SDK (agents), plain cron / systemd timers (schedules).
Why: n8n would be needed only at S5 (3–4 boots away), costs 300–500M RAM — most of the 512M budget — and adds a second runtime to operate. The same is done in code with what we already have.
Consequences: remove n8n from `docker-compose.yml`, `.env.example`, infra README, GitHub Secrets (`STAGING_N8N_*`). Revisit only if S5 proves a concrete need (new decision).

## D-008 — One git worktree per session
Status: accepted 2026-09-20 (S0, after an incident)
Decision: sessions never share a working tree. The main checkout `/Users/bobbob/BOB/SERVER/SH.OS.` belongs to **S1 DevOps** (it was there first). Every other session works in its own worktree: `git worktree add .worktrees/<session> -b <branch> origin/main` (e.g. `.worktrees/s2`, branch `s2-01`). S0 uses `.worktrees/s0`. `.worktrees/` is git-ignored. Never use bare `git stash` — the stash stack is shared across worktrees.
Why: on 2026-09-20 S0 and S1-02 ran concurrently in one checkout; S0's `git checkout -b` moved HEAD away from `s1-02`, S1's first commit landed on S0's branch and got merged via S0's PR #3. Nothing was lost, but the attribution and branch history are muddled.
Consequences: every boot states the worktree path. A session that finds HEAD on a branch that is not its own must stop and report instead of committing.

## D-009 — Report PRs merge `origin/main` first; `memory/` is append-only for child sessions
Status: accepted 2026-09-20 (S0, after three consecutive conflicts in `memory/log.md` / `state.md`)
Decision: before opening or updating a PR that touches `/memory`, a session runs `git merge origin/main` into its branch and resolves conflicts in `memory/` by **keeping both sides** (log entries are appended in time order; in `state.md` each session keeps only its own row's change). Child sessions never rewrite lines they do not own. S0 merges child PRs that touch only `memory/` without waiting for the child.
Why: S0, S1 and S2 all write to the same two files; PRs opened minutes apart conflict every time.
Consequences: a report PR that conflicts is rebased by its author, not by S0 — unless the author has already stopped, in which case S0 resolves and merges.

## D-010 — Back-office shares brand tokens, not components, with the guest site (v1)
Status: accepted 2026-09-20 (S0)
Decision: `apps/backoffice` starts in parallel with `apps/web` and owns its own component set. Shared surface = the 7 brand colours, the two typefaces, motion tokens and the pill CTA — copied from `/docs/design/README.md` as CSS variables in each app. Extraction into a `packages/brand` (or `packages/ui`) workspace package is a later boot once both apps exist.
Why: the two UIs differ (EN guest storefront vs DE dense admin), the design canvas shares no components between them, and waiting for S3 to finish first costs a full boot of wall-clock time.
Consequences: small duplication (one CSS file, one font config) accepted for v1. Neither session edits the other's app.
