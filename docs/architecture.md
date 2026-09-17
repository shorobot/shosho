# ARCHITECTURE — SHOSHO

Оновлює Orchestrator раз на кілька boot-ів. Відображає РЕАЛЬНИЙ стан, не задум. Заплановане позначено `[план]`.

Останнє оновлення: 2026-09-17 — фаза 0, нічого не реалізовано.

## Шари

```
[Гість] ──> apps/web (Next.js) ──┐
                                  ├──> Supabase (Postgres + Auth + Realtime + Storage)
[Оператор] ──> apps/backoffice ──┘         ▲
                                            │
apps/automation ────────────────────────────┘
  ├─ n8n (оркестратор, вебхуки, розклади)          [план]
  ├─ agents/ (Claude Agent SDK): Sales, Accounting, Warehouse, Quality, Grow  [план]
  └─ FastAPI (Lieferando / Wolt / Instagram / Facebook webhooks)              [план]

apps/infra — Docker Compose, GitHub Actions, env-шаблони                     [план]
```

## Середовища
| Середовище | Тригер | Стан |
|---|---|---|
| local | `.env.local` | [план] |
| staging | push у `main` | [план] |
| prod | tag `v*` + ручний approve | [план] |

## Потоки даних (цільові)
1. Гість → web → `orders` (Supabase) → Realtime → backoffice екран оператора
2. Instagram/Facebook DM → FastAPI webhook → n8n → Sales-агент → `leads` / `orders`
3. Lieferando/Wolt → FastAPI → `orders` (джерело = `channel`)
4. Cron (n8n) → Accounting/Warehouse/Grow агенти → звіти в `reports`, Storage

## Реалізовано
Нічого. Скелет репо.
