# Proposal: single-customer GDPR erasure — `anonymise_customer(customer_id)`

Proposed by S2 after S2-03 (2026-09-27). Not executed. S0 assigns the boot number.
Carried over from `S2-03-reports-campaigns-cms.md` §4 and from api-contracts §6.8's closing note:
*"an on-request erasure for a single customer is not in S2-02 — S4 should surface the request and S0
will schedule an RPC for it."*

## Why now
S2-02 ships only the **scheduled** scrub (`anonymise_silent_customers(24)`, nightly, 24 months of
silence). GDPR Art. 17 is a *request* right: a named customer writes in and must be erased on
demand, regardless of how recently they ordered. Today the only way is a manual SQL session against
`shosho-staging` by whoever has the DB password — no audit trail, no role gate, no test. That is the
gap, and it is small to close because `anonymise_silent_customers` already contains the whole scrub.

## Shape
```sql
anonymise_customer(customer_id uuid, reason text default 'request') returns jsonb
```
- **Owner only** (`auth_role() is null or auth_role() <> 'owner'` → `forbidden_for_role`), plus
  `is_service_request()` so automation can call it. Erasure is not an operator-level action.
- Reuses the exact scrub `anonymise_silent_customers` performs — extract that loop body into a
  private `anonymise_one_customer(uuid)` and have both callers use it, so the two can never drift.
- Writes `customer_events(anonymised, {reason, actor_id, requested_at})` — the audit trail is the
  point of having an RPC at all.
- **No silence requirement**: an on-request erasure applies to a customer who ordered yesterday.
- Returns `{anonymised: true, customer_id, orders_kept: n}`; `customer_not_found`, `already_anonymised`
  (idempotent, not an error — return `{anonymised: false, reason: 'already'}`).
- Keeps what GoBD requires (order numbers, dates, items, totals, VAT — 10 years) and drops the PII
  snapshot, exactly as the nightly job does.

## Open question for S0 — the orders' legal hold
The nightly job keeps orders and blanks their PII snapshot. For an Art. 17 request that is the right
answer *only* while the tax-retention period runs. A customer who asks for erasure of an order older
than 10 years should have the order row deleted outright. Proposal: out of scope for v1 (the business
is weeks old), but record the intent in the contract so it is not forgotten — a later
`purge_expired_orders()` job.

## Also needed (not SQL)
- **S4**: a button on the Profil screen behind an owner-only confirm dialog, and a visible
  "anonymised" state on the profile afterwards. Today S4 has nowhere to surface an incoming request.
- **Docs**: `/docs/security.md` GDPR section and `apps/backend/README.md` both currently say the
  scheduled job is the only path.

## Size
One migration, one test file, README + api-contracts §2/§6.8 lines. Roughly a third of a boot — worth
bundling with another small S2 task rather than issuing alone.
