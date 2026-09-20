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
