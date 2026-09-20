# LOG — chronological project journal

Entry format: `## YYYY-MM-DD — S<N> <Name> — S<N>-<NN>` + 2–4 sentences: what was done / what changed in system state / blockers.
Append only. Never delete. Entries before 2026-09-20 are in Ukrainian (pre D-006).

---

## 2026-09-17 — Orchestrator — init
Створено скелет репозиторію: /memory (log, state, decisions, boots/), /docs (architecture, api-contracts), /apps (web, backoffice, automation, infra). Зафіксовано початковий стек у decisions.md (D-001…D-003). Виданий перший boot devops-01. Блокер: GitHub remote та серверний провайдер ще не визначені — вирішує DevOps-01 разом із власником.

## 2026-09-17 — Orchestrator — github-connect
Власник створив org `shorobot`. Створено private repo https://github.com/shorobot/shosho, `main` запушено. Boot devops-01 скориговано: п.1 тепер тільки branch protection, репо не створювати.

## 2026-09-19 — S0 Orchestrator — numbering
Введено нумерацію сесій S0…S7 (+ під-сесії S5.1…S5.5), ростер у /memory/sessions.md. Boot ID = `S<N>-<NN>`, файл `S<N>-<NN>-<slug>.md`, префікс коміту `[S<N>-<NN>]`. devops-01 перейменовано у S1-01.

## 2026-09-20 — S0 Orchestrator — decisions + S1-02
TETA+PI manager granted co-tenant access to the shared droplet (user `shos`, 512M, ports 8200–8299, domain shos.hellfiresol.com) — recorded in /memory/infra-access.md, ssh verified. Owner accepted D-004 (co-tenant staging), D-006 (English repo), D-007 (n8n dropped; orchestration in code). Merged PR #1 (S1-01 infra skeleton; S1-01 closed as partial — no staging live, no Supabase, no report). Memory/docs rewritten in English. Issued S1-02 to adapt infra to the real server terms and bring staging up.
