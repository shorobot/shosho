# BOOT: S7-03 (Security) — design the privilege boundary for `apps/automation` before any of it exists

## Role
You are session S7 (Security) of SHOSHO. This is **step C2** of `memory/plan.md`, and it is the step the
plan calls the real gate. The automation layer will be the **first SHOSHO component to hold privileged
credentials on the host** — every app deployed today is anon-key only. You are designing that boundary
**before the orchestrator exists**, because retrofitting a privilege boundary around working code is the
expensive order and the one that happens by default.

**Design and rule. Do not implement.** No migration, no policy, no grant, no workflow edit, no code in
`apps/automation`. Your output is a ruling other sessions build to.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in
`/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s7` run `git fetch origin && git checkout -f -B s7-03 origin/main`
(`-f -B` — the worktree sits on `s7-02`). Merge `origin/main` before any PR touching `/memory` (D-009).
PR `s7-03` → `main`.
Read FIRST: `/memory/plan.md` (section C, and the paragraph under it headed "Step 2 is the real gate"),
`/memory/decisions.md` — **D-020** (the architecture), **D-013** (what was removed from the server and
why), **D-004** (you do not administer the host, and the host is **shared**), **D-012** (findings routing),
then:

- `.github/workflows/_deploy.yml:148-155` — the "Render .env from secrets" step. Read its comment in full.
  It is the most important paragraph in this boot and it was written by S1 when the keys were removed:
  *"the api container was their only consumer, and this file lands on a shared host, so a service-role key
  with no reader is pure exposure."*
- `apps/automation/.env.example` — written 2026-09-20 and never used. It asks for `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, **`SUPABASE_SERVICE_ROLE_KEY`**, `DATABASE_URL`, **`ANTHROPIC_API_KEY`**.
- `/docs/security.md` — yours. §5 you corrected in S7-02; add this boundary as its own section.
- `boots/S2-08-agent-runtime-schema.md` — the schema being built in parallel (step C1). It is deliberately
  written to not care how the writer authenticated, which is what leaves this ruling yours.
- `proposed/S7-02-S2-payment-security-fixes.md` — specifically **task 1's** story: `place_order` once
  trusted a client-supplied `payment_status` and that was a free-meal vector. **An agent is a client too.**

## Tasks
1. **Rule on the database identity, and this is the central question of the boot.** `.env.example` asks for
   `SUPABASE_SERVICE_ROLE_KEY`. Service role **bypasses RLS entirely** — every policy you swept in S7-02,
   every `is_staff()` guard, every column grant, all of it stops applying. A dedicated Postgres role with
   explicit, enumerated grants would be dramatically tighter and is a real alternative.
   Rule on it: service role, a purpose-made `agent` role, or per-agent roles. Say what each agent in D-020
   actually needs to read and write to do its job, because "the orchestrator needs the service role" is an
   assumption nobody has tested — Accounting reads orders and payments; Grow reads reports; Warehouse will
   write stock; Sales would write drafts. If the answer is a narrower role, say what it may touch and what
   grants that implies, so S2 can write them in a later boot.
2. **Rule on whether the key may live on that host at all.** `_deploy.yml`'s comment is not decoration:
   the `.env` lands on a **shared** droplet, co-tenanted with hellfire and TETA+PI, which SHOSHO does not
   administer (D-004). Weigh the alternatives honestly rather than defaulting to "put it in the `.env`
   like everything else": a narrower DB role whose leak is survivable, keeping the privileged work in a
   Supabase Edge Function that holds its own secret, or something else. If the answer is that it does go
   in the `.env`, say what mitigations come with it and what the blast radius is if that file is read.
3. **Scope, rotate and cap the Anthropic key.** It is a **spend** credential as much as an access one: an
   agent that loops bills the owner's account with nothing in front of it. D-016 already set the precedent
   that unbounded spend is a financial exposure rather than hygiene — it made rate limiting a hard
   precondition of shipping SMS OTP for exactly this reason. Rule on a per-run and per-day ceiling, where
   it is enforced (S2 records cost per run in C1 — enforcement is yours to place), what alarms, who sees
   it, and the rotation path. Name the failure you are preventing in concrete terms.
4. **Write the "an agent may never" list, and make it enforceable rather than aspirational.** For each
   item say *where* it is enforced — a missing grant, a policy, a code check, or merely a convention, and
   be honest when it is the last one. Starting points, not a complete list: no DDL; no writing money
   columns on `orders`; no deleting anything; no reading the `staff` table, which holds PII and is
   owner/operator-only; no sending anything to a customer (D-017 — there is no transport, and the absence
   of one is currently the only thing enforcing it, which is not a control); no touching
   `/etc/nginx/.htpasswd-shos-bo` or any host file.
5. **Prompt injection is a new threat class for this codebase and it is yours to name first.** The Sales
   agent is specified to read Instagram and Facebook DMs — attacker-controlled text. Warehouse will read
   supplier documents. Those are **untrusted inputs driving a privileged actor**, which SHOSHO has never
   had before: every existing input is a typed RPC payload with a server-side guard. Rule on the shape of
   the mitigation — what an agent may do with instructions found in content it reads, which actions require
   a human, and where the boundary between "data the agent summarises" and "instructions the agent follows"
   is enforced. Tie it to task 1's identity ruling: the narrower the role, the smaller the consequence of
   a successful injection, which may be the strongest argument in this boot.
6. **Say what happens when an agent is wrong, because it will be.** Not "if it is compromised" —
   ordinary wrongness: a bad total in a Steuerberater report, a stock figure that silently drifts, an
   invented food cost. What is reversible, what is append-only audit, what a human must confirm before it
   counts. S2's C1 run records are the audit substrate; say whether they are sufficient and what is missing.
7. **Produce the pre-flight checklist S1 will run at step C5.** C5 is the deploy surface and it is blocked
   on this ruling. Give it as a checklist S1 can execute and S0 can verify, including what `_deploy.yml`'s
   D-013 comment must be rewritten to say — it currently instructs a future reader to "restore them next to
   the api service", and the api service no longer exists, so that sentence will mislead whoever acts on it.

## Boundaries
- Do NOT write a migration, policy, grant, trigger or function. Design only. S2 implements what you rule.
- Do NOT create or touch `apps/automation`, or any file in `apps/web`, `apps/backoffice`, `apps/e2e`.
- Do NOT edit `.github/workflows/*` or `apps/infra/**` — S1 owns those. **Say** what must change; S1 changes it.
- Do NOT provision, request or handle an actual key. The owner's Anthropic key is plan item D3 and is theirs
  to create. You rule on how it is treated, never on its value, and no credential enters the repo, a log, a
  commit, a PR body or chat.
- Do NOT edit `/memory/decisions.md` or `/memory/plan.md` (S0's) — propose, and S0 records.
- Do NOT fix S7-02's open items in this boot (the two "green tests that test nothing"). Separate work.
- `/docs/security.md` is yours: add this boundary as a new section. While you are in that file, **one stale
  reference survives #92** — `bo.shos.hellfiresol.com`, dead since the 2026-10-05 rename to
  `bo-shos.hellfiresol.com`. S1-08 flagged two, #92 fixed one. Fix the remaining one.

## Done when
- [ ] A ruling on the database identity: service role vs a dedicated role vs per-agent roles, with each
      D-020 agent's actual read/write needs enumerated rather than assumed
- [ ] A ruling on whether the privileged secret may live in a `.env` on a **shared, third-party-administered**
      host, with the blast radius stated either way
- [ ] Anthropic key: scope, rotation, per-run and per-day ceiling, enforcement point, alarm, audience
- [ ] The "an agent may never" list, each item annotated with **where** it is enforced — and honest where
      the answer is "convention only"
- [ ] A prompt-injection ruling covering untrusted input driving a privileged actor, tied to the identity ruling
- [ ] An ordinary-wrongness section: reversible vs audit-only vs human-confirmed, and whether C1's run
      records are sufficient
- [ ] A pre-flight checklist S1 can execute at C5, including the exact replacement for `_deploy.yml`'s now-stale D-013 comment
- [ ] The surviving `bo.shos.` reference in `docs/security.md` fixed
- [ ] Nothing implemented; no secret anywhere; `infra` and `backend` CI green; PR `s7-03` merged

## Reporting
`/memory/log.md`: `## <date> — S7 Security — S7-03` — the identity ruling and what you measured to reach it,
the shared-host ruling, where you had to say "convention only", and anything in D-020 or the plan that this
work showed to be wrong. **If this ruling means C3 or C5 cannot proceed as the plan describes them, say so
plainly — S0 would rather re-plan than have S5 build against a boundary that does not hold.**
`/memory/state.md`: ONLY the S7 row. Commits `[S7-03]`. Findings outside your boundary → S0, immediately (D-012).

## Next step
C5 (S1's deploy surface) and C3 (S5's orchestrator) both build to this ruling. Still yours: S7-02's two
green-tests-that-test-nothing, and the standing F2 duty — audit before any production deploy, which has
never happened because no production environment exists yet. Proposals → `/memory/boots/proposed/`.
Do not execute. After reporting — stop and wait for S0.
