# API CONTRACTS — SHOSHO

The single place where contracts between layers are fixed. Changed ONLY through S0.
A child session that needs a contract change → writes a proposal to /memory/boots/proposed/.

Status: empty — S2-01 fills the DB schema and REST/RPC; S0 approves.

## Sections (to fill)
1. DB schema (Supabase) — tables, key columns, RLS policies
2. Web → Supabase — tables/RPC used by the guest site
3. Backoffice → Supabase — tables/RPC/Realtime channels for the operator
4. Automation → Supabase — what agents read/write, service-role vs anon
5. FastAPI external webhooks — routes, signatures, payload formats
6. Internal HTTP between apps and automation — routes, auth
