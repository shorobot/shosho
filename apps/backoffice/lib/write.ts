// A write that changed nothing is not a write that succeeded.
//
// S4-03 found this the hard way on `customers`: a PATCH the row policy does not admit comes back
// `{ data: [], error: null }` — RLS filters the rows, it does not raise. `run()` only reports
// `error`, so such a write looks like a save and the screen would show a toast saying so.
//
// Two places on these two screens can hit it even with the route guards in place:
//   · `settings` is OWNER-write (`settings_owner_write` is the only write policy), so an operator's
//     update matches zero rows and silently no-ops.
//   · any `banners` / `promo_codes` / `campaigns` / `automations` write by a role the staff policy
//     does not name does the same.
// Every write on these screens therefore asks for `.select(...)` back and checks it through here.

/** True when a PostgREST write actually touched a row. `select()` must be on the query. */
export function wrote(result: unknown): boolean {
  if (Array.isArray(result)) return result.length > 0;
  return result != null;
}
