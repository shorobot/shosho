# S2 → S0: numbered requests arising from S2-07 (customer accounts, phase A)

Filed 2026-10-23. S2-07's boot says to flag anything I believe `docs/api-contracts.md` §8 (or the
boot itself) gets wrong **as a numbered request here rather than editing elsewhere**. The only file
I edited in `docs/` is the new §9. Each item below is a decision for S0, not a change I made.

---

## 1. `D-021` does not exist — the boot cites a decision that was never recorded

The boot cites **D-021** three times as binding, recorded text: *"D-021 (the email tie-break
below)"*, *"**D-021 settles the email half**, which finding 5 left under-specified"*, and the
done-when *"`link_my_account()` implements the rule in task 2 **and** D-021's email tie-break"*.

**Measured:** `memory/decisions.md` ends at **D-020**. `grep -n '^## D-' memory/decisions.md`
returns D-001 … D-020 and nothing else; there is no D-021 anywhere in `memory/`.

I implemented the rule, because the boot states it in full and the boot is the instruction. But it
is **the boot's text, not a decision**, and §9.2 says so rather than citing a decision number that
would dead-end for the next reader.

**Request: record it as D-021 (or renumber), covering (a) the phone-then-email matching order,
(b) link on exactly one eligible email candidate, (c) two or more → fresh row, (d) a NULL email
matches nothing, (e) `anonymised_at` rows are never candidates** — and, if ratified, the
`kitchen_note` condition in request 2.

## 2. Finding 5's stated rule does not prevent the disaster finding 5 describes

This is the most important item here, and it is a food-safety one.

Finding 5's remedy, carried verbatim into the boot as non-negotiable:

> link on first login **only** when the account's verified identifier matches the customer row's
> identifier **and** that row has no other account attached. […] **Never merge on a phone match
> alone.**

Those two sentences contradict each other, and the first one does not do the job:

- **A guest row is unlinked by definition.** `place_order` creates every customer row with no
  account. So "matches the phone **and** has no other account attached" is satisfied by exactly the
  rows a recycled number lands on — the rule links it, and `customers.kitchen_note` (*"copied to
  `orders.allergy_note` on every order"*) goes with it. That is the inherited allergy note finding 5
  is about.
- The "no other account attached" guard prevents **account takeover** (B hijacking A's *account*),
  which is a different threat from **record inheritance** (B inheriting A's *guest row*).
- And the rule as written *does* merge on a phone match alone, which the last sentence forbids.

**What I shipped**, as a strict tightening rather than a substitution, so I am not quietly
overruling a stated non-negotiable: a third eligibility condition, **`kitchen_note is null`**. The
reasoning is that the column which makes mis-linking a *food-safety* defect rather than a privacy
one is exactly `kitchen_note`; rows without one carry order history and saved addresses, which is
the risk the product has already accepted since S2-01 (guest checkout matches profiles by phone and
the design's own rule says *"Customer profile is created automatically from the first order (matched
by phone)"*). Rows **with** one are refused with `staff_merge_required` + `profile_has_kitchen_note`
and audited on the timeline.

**Request: ratify or overrule.** Two things to weigh if you overrule:

- Clearing the note on link is **not** the safe alternative: deleting a real allergy note is a
  worse food-safety defect than inheriting a wrong one, and silently.
- Linking and flagging for staff re-confirmation is probably the best product answer, but it needs
  a back-office surface (S4) that does not exist, so it was not mine to invent.

## 3. "Otherwise start a fresh customer row" is not implementable for a phone match

Finding 5 and the boot both say that when a candidate is ineligible, *"start a **fresh** customer
row"*. **`customers.phone` is `text not null unique`** — so when the ineligible candidate is the
one holding that phone, a fresh row cannot be created at all; it would need the same phone.

`link_my_account()` therefore returns `staff_merge_required` for the phone branch (and still
creates a fresh row for the email branch, where the identifier is not unique and the verified phone
is free). The boot's done-when item *"recycled number → fresh row"* is **not achievable as written**;
what the tests assert instead is the refusal plus the property the item actually protects — the
stranger's `kitchen_note` provably unreachable by every path that JWT has.

**Request: confirm that `staff_merge_required` is the intended outcome**, and note that it leaves
the person unable to register on that number until staff act — which phase B must render as a
"call us" state, not a retryable error (§9.2).

## 4. `settings.draft` is reachable by a customer JWT — the one place "safe by construction" fails

Found while doing task 4, measured, **not fixed** (it crosses S4's read path and S2-06's design).
Full detail is in the block comment above the `[S2-07] known finding` suite in
`apps/backend/tests/security.test.ts`, and in `memory/log.md`. In short:

- Migration 32 named this exact pitfall (RLS is row-level, not column-level) and fixed it **for
  `anon`** with a column grant, deliberately leaving `authenticated`'s blanket grant because
  "owner/operator continue to see `draft` on the rows their existing ROW policies already admit
  them to". Sound — while `authenticated` could only be staff.
- Migration 35 creates the second class of authenticated user. A customer passes
  `settings_public_read` (`key = any (settings_public_keys())`, which includes `site`), so a
  **customer reads `settings.draft` on the `site` row**: the unpublished site copy.
- **Column privileges cannot fix it**, because a customer and an operator are the same Postgres
  role. Narrowing `authenticated`'s column list would also blind the back-office draft editor
  (§6.6 reads `from('settings')` directly).
- `banners.draft` is **not** affected — `banners` is staff-only and `banners_live` has an explicit
  column list. S2-06 got that one right.

**Nothing is exposed in production today** (phase A ships no login, so no customer JWT exists).
**It must be resolved before phase B ships one.**

**Request: rule on which fix, and who owns it.** Candidates: (a) move `draft` to its own staff-only
table keyed on `settings.key`; (b) serve the public settings through a security-definer
view/RPC and narrow the table grant; (c) accept it and document it. (a) is the clean one and is
S2's to write; (b) changes S4's read path.

## 5. §8.8's `customer_events.type` is a closed CHECK list with no account-link type

`link_my_account()` audits every decision as a `note` event with
`payload->>'event' = 'account_link'`, because migration 35 was scoped to add the identity column
"and nothing else structural" and widening the `type` CHECK is structural.

**Request: approve `account_link` as a `customer_events.type` value** in whichever boot next touches
that table, so the back-office can filter on type instead of on a payload key. Until then the
back-office selector is `type = 'note' and payload->>'event' = 'account_link'`.

## 6. `anonymise_silent_customers` does not clear `auth_user_id`

Migration 17 predates the column, so an erased customer whose auth account still exists keeps the
link. `current_customer_id()` excludes `anonymised_at is not null` rows defensively, so the
self-service surface already refuses them — but the stale link remains in the row.

**Request: add `auth_user_id = null` to that function's UPDATE** in whichever boot next touches the
anonymisation path. Not done here: it is on a nightly cron path and changing it is a separate blast
radius from this phase's.

## 7. The boot's own numbering: this is S2-07 by name, S2's tenth branch

Noted for the record rather than as a request. The boot is titled **S2-07** and the ROADMAP assigns
phase G to **S2-09** — but `s2-08` and `s2-09` have already merged (PR #101 and the agent-runtime
work in migrations 33/34), and there has never been an `s2-07` branch. `state.md` still lists
S2-07 as "queued, blocked on the owner's SMTP choice per D-017 and on the one unconfirmed clause of
D-016". The branch for this work is `s2-07`, as the boot instructs.

Also for the record: **D-016's "accounts are optional" clause still carries its unconfirmed marker
in `memory/decisions.md`** — *"(This clause is S0's stated assumption … Confirm before S2-07 is
issued.)"* — and the 2026-10-22 log entry is about D13/TETA+PI/B2 and two stale reports, not about
D-016. The boot says the owner confirmed it on 2026-10-22 and that it is "now D-016's recorded
text"; **it is not recorded anywhere in `memory/`.** I proceeded on the boot's authority, and this
phase's work is in any case the half that is safe either way — it adds an optional column and
changes no guest behaviour. **Request: record the confirmation in D-016 and drop the marker**, since
every later phase reads that clause.
