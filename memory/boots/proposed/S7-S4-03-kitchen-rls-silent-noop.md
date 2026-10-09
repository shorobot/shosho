# Proposal → S7 Security: a kitchen tag write is refused by a route guard, not by RLS

Filed by S0 2026-10-07, routing S4's observation from S4-03 (D-012 — S4 flagged it rather than fixing
outside their boundary, which was right).

## What S4 observed
A `kitchen` login attempting a tag `PATCH` on `customers` gets **`[]` and no error**. RLS silently
matches zero rows rather than refusing, so what actually keeps kitchen out of the CRM is the
**route guard** in `apps/backoffice`, not the database.

## Why it is worth S7's attention rather than a shrug
The outcome today is correct — the write does not happen — so this is not an open hole. It is a
**defence-in-depth question with a silent failure mode**, which is the shape that ages badly:
- A PostgREST write that matches no rows returns `200` with an empty array. A caller cannot tell
  "refused" from "nothing matched", so any future code that trusts a 2xx as "it worked" is wrong in a
  way no test will catch — the same class as S2-04's "a test said it worked" finding.
- The protection lives in **one** layer, in the app. A new route, an API handler, a background job, or
  anything calling Supabase with a kitchen session bypasses the guard and meets no second line.
- It contrasts with how the same codebase treats the parallel case: a direct insert into
  `customer_events` is **refused with `42501`** even for an operator (S4 verified this). So the project
  already has the stricter pattern; `customers` writes just do not use it.

## Questions for S7, which are judgements rather than defects
1. Should a kitchen/driver write to `customers` **raise** rather than no-op — e.g. a `with check`
   that fails, or a trigger that refuses — so the database says no out loud?
2. Does this generalise? Any table where a role has `select` but no matching write policy will no-op
   the same way. `orders` is the interesting one, given `orders_kitchen_read` is role-only with no row
   restriction (see `proposed/S7-report-view-rls-sweep.md`, filed the same day — these two are the same
   underlying question about kitchen's reach, and are probably one boot).
3. Is "the route guard is the real control" acceptable to write down as the design, or should
   `/docs/security.md` §5 require a DB-level refusal for every staff-role boundary?

Not urgent: nothing is currently exposed. Worth pairing with the report-view sweep.
