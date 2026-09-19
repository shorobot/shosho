# LOG — хронологічний журнал проєкту SHOSHO

Формат запису: `## YYYY-MM-DD — S<N> <Назва> — S<N>-<NN>` + 2-4 речення: що зроблено / що змінилось у стані / блокери.
Дописуємо тільки в кінець. Нічого не видаляємо.

---

## 2026-09-17 — Orchestrator — init
Створено скелет репозиторію: /memory (log, state, decisions, boots/), /docs (architecture, api-contracts), /apps (web, backoffice, automation, infra). Зафіксовано початковий стек у decisions.md (D-001…D-003). Виданий перший boot devops-01. Блокер: GitHub remote та серверний провайдер ще не визначені — вирішує DevOps-01 разом із власником.

## 2026-09-17 — Orchestrator — github-connect
Власник створив org `shorobot`. Створено private repo https://github.com/shorobot/shosho, `main` запушено. Boot devops-01 скориговано: п.1 тепер тільки branch protection, репо не створювати.

## 2026-09-19 — S0 Orchestrator — numbering
Введено нумерацію сесій S0…S7 (+ під-сесії S5.1…S5.5), ростер у /memory/sessions.md. Boot ID = `S<N>-<NN>`, файл `S<N>-<NN>-<slug>.md`, префікс коміту `[S<N>-<NN>]`. devops-01 перейменовано у S1-01.
