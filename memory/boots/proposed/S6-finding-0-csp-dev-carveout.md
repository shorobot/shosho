# PROPOSAL (re-filed by S0) — S6-01's finding 0 was never tasked: both apps' CSP blocks all client JS under `next dev`

## Owner
Two sessions, one line each. `apps/web/lib/csp.ts` is **S3's**; `apps/backoffice/lib/csp.ts` is **S4's**.
Fold into each session's next boot, or issue as two tiny boots — do not give one session both files.

## Why this exists as a re-file rather than a finding
S6-01 found this, rated it **HIGH**, and filed it **first** in both routing files
(`proposed/S6-02-S3-guest-tracking-realtime.md` and
`proposed/S6-02-S4-cash-confirmation-vat-label-login-hardening.md`, each as "finding 0"; the S4 file's own
title reads "**four** back-office findings"). **S0 then issued S4-05 saying "Three of S6-01's QA findings
are yours" and issued S3-03 with no CSP task at all.** The finding was in both sessions' required reading
and in neither's task list — which is the worst place to leave a HIGH finding, because it looks routed.
Both sessions ran (PRs #87 and #89) and neither touched it. Verified 2026-10-15: `grep -c unsafe-eval` is
**0** for both files on `main`, `s3-03` and `s4-05`.

## The bug
`apps/web/lib/csp.ts:53` and `apps/backoffice/lib/csp.ts:137` both emit:
```
script-src 'self' 'nonce-${nonce}' 'strict-dynamic'
```
with no `'unsafe-eval'` and no `NODE_ENV` branch. `next dev`'s webpack HMR runtime evaluates chunks via
`eval()`, which that CSP blocks outright. **The failure is total, not partial:** the server-rendered HTML
paints normally, so the page looks healthy, but no client JavaScript executes — nothing hydrates, no event
handler is ever attached. A click lands visibly (Chrome shows `:active`) and does nothing, with no console
error unless you inspect the CSP header specifically. `next build` / `next start` — what `shosho-staging`
runs — does not use `eval()`, so it is **completely invisible in production**, confirmed by S6 driving the
live deployed site.

S6 lost four CI rounds to plausible-but-wrong timing theories (a cookie banner, lazy per-route compilation,
a `useEffect` race) before reading the Playwright trace's `pageError`, which had carried the exact CSP
message since run 1. They recorded that as the lesson rather than the finding, and it is the same lesson
S0 has now learned twice: **open the artifact before naming the cause.**

## The fix
Add `'unsafe-eval'` **only** when `process.env.NODE_ENV !== 'production'`.

Requirements, because the easy version of this is a production regression:
- The production header must be **byte-identical** to today's. Print the emitted `script-src` under both
  `NODE_ENV` values and show both, rather than asserting it.
- Keep each file's top comment honest. Both explain why the nonce CSP is safe; they must now also say why
  dev differs and that the carve-out must never reach a built output.
- `apps/web`'s comment additionally warns that the nonce CSP is only safe because the root layout is
  `force-dynamic` — leave that intact, it is unrelated and still true.
- Each session touches **only its own app's file**. Same bug, same line, two owners.
- **Tell S7 (D-012)** even though it is dev-only: S7-02 is auditing headers and should not meet an
  `'unsafe-eval'` in a CSP as a surprise.

## Why it is worth doing promptly
It blocks development rather than a feature, and it bit precisely the two boots that could least afford it:
S4-05 built a click-driven cash dialog and S3-03 a realtime subscription — both pure client-side JavaScript,
neither verifiable on a developer's machine as shipped. Both sessions reported done anyway, which means
**their local verification of any interactive behaviour was running against a page whose JS never
executed.** When reviewing #87 and #89, treat "verified locally" claims about interactive behaviour with
that in mind, and prefer their staging or data-layer evidence.
