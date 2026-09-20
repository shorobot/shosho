# SESSIONS — roster

Every session has a permanent number. Boot ID = `S<N>-<NN>` (session-sequence). Boot file: `/memory/boots/S<N>-<NN>-<slug>.md`. Commit prefix: `[S<N>-<NN>]`. Log heading: `## <date> — S<N> <Name> — S<N>-<NN>`.

| ID   | Name         | Responsibility (one line)                                              | Starts after |
|------|--------------|-------------------------------------------------------------------------|--------------|
| S0   | Orchestrator | CTO: memory, decomposition, issuing boots, contracts, decisions.md      | —            |
| S1   | DevOps       | GitHub, server, CI/CD, staging/prod, secrets, local env                 | —            |
| S2   | Backend      | Supabase: schema, RLS, RPC, order business logic                        | S1-02        |
| S3   | Frontend     | Guest site + ordering (Next.js, apps/web)                               | S2-01        |
| S4   | Back-office  | Admin panel: operator orders, menu, basic CRM (apps/backoffice)         | S2-01, S3-01 |
| S5   | Automation   | AI-agent layer: Claude Agent SDK + FastAPI (apps/automation)            | S4-01        |
| S5.1 | ↳ Sales      | DM lead-gen, orders from Instagram/Facebook                             | S5-01        |
| S5.2 | ↳ Accounting | Bookkeeping, reports for the Steuerberater                              | S5-01        |
| S5.3 | ↳ Warehouse  | Stock, food cost                                                        | S5-01        |
| S5.4 | ↳ Quality    | Computer vision (late phase)                                            | S5-01        |
| S5.5 | ↳ Grow       | Analytics, growth proposals                                             | S5-01        |
| S6   | QA           | End-to-end scenarios, regression after every boot                       | S4-01        |
| S7   | Security     | Auth, API hardening, secrets audit, gate before every prod deploy       | S4-01        |

External peer (not our session): **TETA+PI manager** — admin of the shared server, reachable via `send_message` → `teta-pi-e0`. See `/memory/infra-access.md`.

New sessions beyond this list — S8, S9, … Sub-sessions — `S<N>.<M>`. Numbers are never reused.

## Boot counters (last issued)
S0: — · S1: 03 · S2: 01 · S3: — · S4: — · S5: — · S6: — · S7: —
