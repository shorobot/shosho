# BOOT: S1-08 (DevOps) — get the back-office gate into a state staff can actually use

## Role
You are session S1 (DevOps) of SHOSHO. One job, two possible endings: the back-office URL works, the app behind it works, and **nobody can get in** because the outer gate's password exists only as a hash on the server. Ask TETA+PI for it so staff can be let in this week, and prepare the better arrangement the owner may choose instead. Small boot — do not expand it.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** the root checkout `/Users/bobbob/BOB/SERVER/SH.OS.` is yours. `git fetch origin && git checkout -b s1-08 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s1-08` → `main`.
Read FIRST: `/memory/state.md` — the "Back-office access" block and owner actions **1b**, **6**, **6b**; `/memory/infra-access.md` (how to reach `teta-pi-e0`, and the standing rule **no secrets in that file, ever**); `/memory/decisions.md` **D-004** (you do not administer the host) and **D-010**.

**Everything except the gate credential is done and verified.** Do not re-verify it; S0 measured all of this on 2026-10-10/11:
```
https://bo-shos.hellfiresol.com/   401, Basic realm="SHOSHO back-office (staging)", via Cloudflare
http://bo-shos.hellfiresol.com/    301 → https   (scoped Redirect Rule, not the zone-wide toggle)
/login                             401 — gate sits in front of the app
app behind the gate (tunnel)       200 + nonce CSP, frame-ancestors 'none', permissions-policy,
                                   referrer-policy: no-referrer, nosniff, X-Frame-Options: DENY
staff logins                       all four rotated accounts authenticate (owner verified 2026-10-11)
/etc/nginx/.htpasswd-shos-bo       -rw-r----- root:www-data, 69 B — a HASH, unreadable by `shos`,
                                   not reversible. This is the whole remaining problem.
```

## Tasks
1. **Ask `teta-pi-e0` for the gate credential.** One message. Ask them to either tell the owner the plaintext they set on 2026-09-26, or — better, and say why — **set a fresh pair now** and hand that over, since a credential chosen a fortnight ago for a host nobody could reach has no reason to be the one staff keep. Request it be delivered to the **owner directly**, not into this repo or a log: `/memory/infra-access.md` says no secrets there, ever, and that rule is why we are asking rather than reading. Do not ask for anything else in this message.
2. **Tell them where it is going, because it affects what they should choose.** The owner is deciding between keeping basic-auth and moving to Cloudflare Access (owner action 6b). If they move, TETA+PI will later be asked to **remove** the gate — so mention now that a fresh pair might be short-lived, and let them decide whether that changes how they issue it. Surprising a host admin with "actually, remove the thing you just made" is how goodwill gets spent.
3. **When the owner reports Access is configured — and only then — verify it from outside before anyone relies on it.** Use the method that has held all month: `curl --resolve`, compare bodies rather than status codes, and check the cases nobody configured:
   - an unauthenticated request to `https://bo-shos.hellfiresol.com/` is challenged by **Access**, not merely passed through to basic-auth;
   - an email **outside** the allow-list is refused — test it, do not assume the policy means what it says;
   - `/login` is still unreachable without authenticating;
   - `https://shos.hellfiresol.com/` is **unaffected** — the storefront must not acquire a login screen, and this is the check that catches an Access app whose hostname pattern is too broad;
   - the direct origin path still answers `401` from nginx, i.e. basic-auth is still carrying the origin leg.
4. **Only after task 3 passes, ask TETA+PI to drop basic-auth — and say in the same message what must replace it.** This is the ordering that is easy to get wrong and expensive if you do: **the direct origin path (`164.90.235.66:80` / `:443` with `Host: bo-shos…`) is covered by basic-auth alone today.** Removing the gate without restricting the origin to Cloudflare leaves the app reachable by anyone who bypasses the edge. So the request is two things, not one: remove basic-auth **and** restrict that vhost to Cloudflare's IP ranges (or an authenticated-origin-pull equivalent — their call, they administer nginx). If they can only do the first, **say stop** and report back; do not accept a half-change.
5. **Re-verify after that change too**, with the same probes plus: the direct origin path must now be **refused**, not 401'd, and the edge path must still work. Report both.

## Boundaries
- Do NOT edit nginx, DNS, the origin certificate, Cloudflare, or any htpasswd file. You have no sudo and no nginx access (D-004); the zone is the owner's and is shared with hellfire and TETA+PI.
- Do NOT attempt to read `/etc/nginx/.htpasswd-shos-bo` or crack its hash. S0 already established it is `0640 root:www-data`, unreadable by `shos`, and that an htpasswd hash is not reversible. There is nothing there to get.
- Do NOT put the gate credential — or any credential — into `/memory/infra-access.md`, a log entry, a commit, a PR body, or chat. It goes to the owner directly.
- Do NOT configure Cloudflare Access yourself; it is the owner's action 6b. You verify it, you do not build it.
- Do NOT ask the owner to pin this hostname to **Flexible** (struck in `state.md`, with reasons), or to flip the zone-wide **Always Use HTTPS** toggle — the scoped Redirect Rule already does the job and the zone is shared.
- Do NOT touch `apps/backoffice` (S4-04 live), `apps/e2e` (S6-01 unlanded), or `apps/backend` / `docs/security.md` (S7-02 live).
- Do NOT hand the URL plus credentials to anyone yourself. The owner decides who gets access and when.

## Done when
- [ ] One message sent to `teta-pi-e0` asking for the plaintext or a fresh pair, delivered to the owner directly, with the Access caveat from task 2 included
- [ ] Either: Access verified from outside against all five checks in task 3 — or correctly reported as not yet configured, with nothing assumed
- [ ] If Access is live: basic-auth removal requested **together with** origin restriction, and refused as a half-change if they can only do one
- [ ] Post-change re-verification showing the direct origin path refused and the edge path working
- [ ] No credential anywhere in the repo, the log, a commit or a PR
- [ ] PR `s1-08` merged

## Reporting
1. `/memory/log.md`: `## <date> — S1 DevOps — S1-08` — what you asked, what TETA+PI said, what you measured, in the table shape you used in the S1-05 addendum. State plainly if you are still waiting.
2. `/memory/state.md`: ONLY the S1 row.
3. Commits `[S1-08]`.
4. Security findings outside your boundary go straight to S7 (D-012) — tell S0, do not wait.

## Next step
`proposed/S1-prod-target.md` and `proposed/S1-explicit-secrets-map.md` are both still queued; S0 schedules them. Do not execute. After reporting — stop and wait for S0.
