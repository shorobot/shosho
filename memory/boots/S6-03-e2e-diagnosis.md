# BOOT: S6-03 (QA) — the suite has never been green; the CSP theory is dead, measured. Diagnose the real 16.

## Role
You are session S6 (QA). The cross-app suite **has never finished green** — 0 successes since
2026-10-15. This boot is **diagnosis, not repair**: the deliverable is a classification of every
remaining failure with evidence, not a green run.

**Read this first, because it kills the theory you will otherwise inherit.** A draft boot for S3 asserted
*"It is your CSP"* and predicted the dev-CSP carve-out would fix **most of the sixteen**. The carve-out
shipped (#110, merged 2026-10-24). S0 measured before and after:

| run | result | failing set |
|---|---|---|
| `39640593470` — 2026-10-21, **before** | 15 passed / **16 failed** / 2 skipped | 16 names |
| `41443441607` — 2026-11-02, **after** | 15 passed / **16 failed** / 2 skipped | **identical, `diff` empty** |

**The CSP fix changed nothing in this suite.** The carve-out was still correct and worth shipping (S6's
own finding 0, HIGH, `apps/web` was non-interactive under `pnpm dev`), but it was **not** the thing
hiding the other failures. Do not re-run that reasoning. Do not look for a single root cause before the
evidence says there is one — the previous attempt to name one cost two timeout bumps and this prediction.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in
`/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s6` run `git fetch origin && git checkout -f -B s6-03 origin/main`.
Use `checkout -f`, not `reset --hard`. Never touch another session's worktree; never bare `git stash`.

Read first: `memory/plan.md` (the **B9** row — its framing "re-point the inverted specs" is **too narrow**,
see below), `memory/decisions.md` **D-015** (no client-side analytics), **D-012** (findings to S7).

### The 16, as measured on `80e65b9`
```
cancellation-refund.spec.ts:23   operator cancels a new order with a reason
cancellation-refund.spec.ts:46   owner refunds a paid, completed order
checkout-delivery.spec.ts:10     guest delivery order end to end
checkout-pickup.spec.ts:12       pickup order: 10% discount, 19% VAT
i18n-consistency.spec.ts:9       DE/EN toggle changes labels only
money-consistency.spec.ts:10     one order's cents agree across quote/cart/checkout
phone-order.spec.ts:7            operator creates a phone order
preorder.spec.ts:6               pre-order for a future slot
product-rules.spec.ts:38         allergy note propagates onto a new order
realtime-and-tracking.spec.ts:50 "apps/web never subscribes to that broadcast"
realtime-and-tracking.spec.ts:74 tracking page resolves once the order is final
rejections.spec.ts:10            below minimum order for the zone
rejections.spec.ts:20            postal code outside every zone
rejections.spec.ts:32            kitchen paused
rejections.spec.ts:43            'Operator can pause intake' visible on the board
stoplist-and-catalog-drift.spec.ts:6  item stoplisted while already in the cart
```

**Only ONE of these is inverted by its own title** — `realtime-and-tracking.spec.ts:50`, which asserts
`apps/web` *never* subscribes, and S3-03 made it subscribe. **B9's framing assumed most of them were that
shape. The titles say otherwise**: the other fifteen are substantive assertions about checkout, money,
cancellation, rejections and the board. **That is why this boot exists and B9 alone would not have been
enough.**

## Tasks

**1. Classify all 16, with evidence from the artifact — not from reading the spec.**
Playwright writes traces and screenshots; download the run's artifacts and open them. For each failure,
one line of what the evidence *shows*, and exactly one bucket:
- **(a) inverted** — the spec asserts a gap the product has since closed. It goes red *because the product
  was fixed*. That is the intended signal. **Name it; do not quietly rewrite it** (task 3).
- **(b) real product defect** — file it to the owning session (D-012 for security), do not fix it here.
- **(c) broken test** — wrong selector, wrong assumption, raced on something it should wait for.
- **(d) environmental** — the stack, the data, the runner. **Prove it**: an environmental claim that is
  really a product bug is the single most expensive mistake this project has made (S6-01's own
  `toomanyrequests` episode, where S0 called 18 genuine failures "environmental" from a grep).

**2. Answer one question explicitly, because two sessions have assumed opposite answers:
has this suite ever passed against the current product, on any commit?** 0 successes since 2026-10-15 is
recorded, but nobody has said whether the suite was ever *correct* and drifted, or was **born red** and
has never matched the product. The answer changes who owns every bucket-(c) item.

**3. Re-point the inverted ones — the only repair in this boot.** A spec that asserts a closed gap should
assert the *new* truth. `apps/e2e/` is yours and only yours. **Do not touch `apps/web`, `apps/backoffice`,
`apps/backend`, `apps/automation` or `apps/infra`** — if a product change is needed, it is a finding.

**4. Two are known to fail inside the back-office and are not yours to fix.** `phone-order.spec.ts` and
`rejections.spec.ts:43` drive the back-office. The CSP carve-out shipped there in #89 and the login form
already carries `method="post"` — so neither the CSP bug nor the password-in-URL bug explains them.
Classify them with evidence and stop; the fix is S4's.

## Boundaries
- **Diagnosis first.** The only code you change is `apps/e2e/`, and only for bucket (a).
- **Do NOT raise any Playwright timeout, add a retry, or insert a wait.** Two bumps (15 s → 25 s) have
  already been spent on a theory that turned out to be wrong. A third would hide what this boot is for.
- **Do NOT fold `e2e` back into `CI`'s `needs`** — that is what silently killed the deploy chain after #77.
- No client-side analytics (D-015). No secrets; anon key only.
- If the suite turns out to need a product change to pass, **that is a result**, not a failure of this boot.

## Done when
- [ ] All 16 classified into (a)/(b)/(c)/(d), each with **one evidence-based sentence from the trace or
      screenshot**, not from reading the spec source
- [ ] The "has it ever passed?" question answered in as many words
- [ ] Bucket (a) re-pointed in `apps/e2e/`; every other bucket **filed, not fixed**
- [ ] `phone-order` and `rejections.spec.ts:43` classified with evidence and handed to S4
- [ ] The new passed/failed/skipped triple reported as a number; **if it does not move, say so plainly**
      rather than explaining why it should have
- [ ] No timeout raised, no retry added, `apps/e2e/` the only directory touched

## Reporting
Append one entry to `memory/log.md`; update **only the S6 row** in `memory/state.md`. Open a PR and leave
the merge to S0 (D-009). Be explicit about:
- anything that **contradicts this boot**, S0's reading of the before/after comparison included;
- anything you could **not** verify, stated as not verified rather than implied;
- whether any bucket came out **empty** — that is a real result too.

## Next step after you
**This suite is also the gate on something larger than itself.** The owner is preparing to clone this
codebase as the first of a series (the La Machine programme). A suite that has never been green cannot
tell a clone from a regression, so every defect it is currently hiding would be **copied into every
client's deployment**. Your classification is what makes "is the clone healthy?" an answerable question.
