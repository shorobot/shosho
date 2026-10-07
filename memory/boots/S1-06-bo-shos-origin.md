# BOOT: S1-06 (DevOps) — verify `bo-shos.hellfiresol.com` on the origin, and one thing you do not yet know

## Role
You are session S1 (DevOps) of SHOSHO. **You have already sent the request this boot was originally written to ask for** — your S1-05 addendum (commit `0a3e24a`) did it, and did it better than the boot asked, by recommending the dead `bo.shos.` be dropped from the SAN rather than carried alongside. So this boot is smaller than it looks: verify TETA+PI's change when it lands, and absorb one finding from S0 that you could not have had. Do not expand it.

## Context
Repo: https://github.com/shorobot/shosho. The root checkout `/Users/bobbob/BOB/SERVER/SH.OS.` is yours (D-008). `git fetch origin && git checkout -b s1-06 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s1-06` → `main`.
Read FIRST: `/memory/state.md` (the back-office hostname block), `/memory/infra-access.md` (how to reach `teta-pi-e0`, and the terms — we do not administer the host), and S0's log entries of 2026-10-05.

**Where this stands.** The owner renamed the record to `bo-shos.hellfiresol.com` (one label, so Cloudflare's free Universal SSL — `hellfiresol.com` + `*.hellfiresol.com` — now covers it). You and S0 measured the consequences **independently and agreed on every point**, including the one neither of us predicted: that `:80` lands on TETA+PI's own default vhost. Two independent measurements reaching the same conclusion is the strongest evidence this project has produced about the origin; it is recorded as such and is not being re-litigated.

**The measurements, for reference — yours and S0's, which match:**

```
dig bo-shos.hellfiresol.com        → 104.21.25.237 / 172.67.168.47 (Cloudflare) ✅
edge cert for bo-shos              → CN=hellfiresol.com, SAN hellfiresol.com + *.hellfiresol.com
                                     → one label, so bo-shos IS covered. Edge TLS completes. ✅
https://bo-shos.hellfiresol.com/   → HTTP 525 (Cloudflare: SSL handshake with origin failed)
origin :443, SNI bo-shos           → tlsv1 alert unrecognized name — ssl_reject_handshake refuses it
origin cert SANs                   → DNS:bo.shos.hellfiresol.com, DNS:shos.hellfiresol.com
                                     → the OLD name. `bo-shos` is not on it. This is the whole bug.
origin :80, Host: bo-shos          → 200, {"name":"TETA+PI API", … ,"mcp":"/mcp/sse"}
origin :80, Host: nonexistent      → the same body → that is nginx's DEFAULT :80 server block
origin :80, Host: bo.shos          → 401 nginx (the old vhost is still there and still gated)
origin :443, SNI bo.shos           → 401 nginx (ditto)
https://shos.hellfiresol.com/      → unaffected, 200
```

Read the two results together: the `:443` leg fails **safely** (the handshake is refused, so Cloudflare returns 525 rather than someone else's content — `ssl_reject_handshake`, which you had verified in S1-05, is doing exactly its job). The `:80` leg has no such mechanism, so our unconfigured name falls into nginx's default server block, which on this host is **TETA+PI's own API**. Nothing of SHOSHO's is exposed by that and no SHOSHO data is involved — the direction is outward, their public API surface answering under our name — but they should be told, because it is their surface and they may not know an unconfigured name reaches it.

## Tasks
1. **Already done, and already accepted — do not re-send it.** Your addendum asked for both halves in one message; TETA+PI accepted all of it and issued their own boot 5.17. S0 reviewed and accepts it as issued — the SAN recommendation is an improvement on what S0 would have asked for, and escalating their `:80` `default_server` gap into the same boot rather than filing it separately was the right call. **One thing to watch, and it is the only live risk here: their Cloudflare API token expires 2026-10-10.** If the reissue has not landed by then the request needs re-sending against a new token. That is the single reason to speak to them again — not a progress chase.
2. **Verify from outside when they report it done — do not take the report at face value.** Use the S1-05 method, which is the house standard for a reason: `curl --resolve <name>:443:164.90.235.66` so real SNI is sent, and **compare body hashes, not status codes** (S0 once read a 200 from a no-SNI probe as proof a name was served, and it was another tenant's page). Check, at minimum:
   - origin `:443` SNI `bo-shos` → nginx's own 401, and still 401 when wrong credentials are supplied, so the gate actually checks rather than decorating;
   - origin `:80` Host `bo-shos` → 401, **not** TETA+PI's API JSON — this is the specific regression to look for;
   - certificate SANs are exactly what was agreed, and hellfire's apex is still untouched (`CN=hellfiresol.com`, SAN apex+www, its own byte size);
   - unknown SNI is **still** refused at the handshake on `:443` — confirm they did not reintroduce a default server block while editing;
   - **the new `:80` `default_server` landed**: `curl -H 'Host: totally-unknown-probe.example' http://164.90.235.66/` should now be refused (`return 444` closes the connection), not 200 with their API body. This is their fix to their own gap, but you are the one with a measurement harness pointed at it, and you verified the claim — so verify the fix;
   - hellfire's certbot ACME path on `:80` still works, or at least that the `444` block did not blanket `/.well-known/acme-challenge/`. That is hellfire's production certificate renewal and is not TETA+PI's to break; if you cannot test it safely, say so rather than guessing;
   - `https://shos.hellfiresol.com/` unaffected: 200, the real SHOSHO page, and the only "hellfire" string in the body is our own `siteUrl`;
   - `https://bo-shos.hellfiresol.com/` through the edge → 401 from nginx, no longer 525.
3. **Absorb this, because it is the one thing you do not have.** S0 traced the `:80` finding to a consequence you could not see from the origin side: it makes a step that was sitting on the **owner's own action list** dangerous. That list told the owner to "duplicate the 2026-09-26 Configuration Rule with the hostname changed" — and that rule pins a hostname to **Flexible**, i.e. Cloudflare fetches the origin over `:80`. For `bo-shos.` that is TETA+PI's API, so following the step would have served their API under `https://bo-shos.hellfiresol.com/` with a valid certificate, 200, silently — the 2026-09-30 cross-tenant failure in the opposite direction, introduced by our own documentation. It is struck from `state.md` in the same change that issued this boot. **If the owner, TETA+PI or a later session proposes a Flexible rule for this hostname, say why not.** The 525 you measured is the better state: broken and obvious beats working and wrong. Note also that your `ssl_reject_handshake` from PR #53 is what makes the `:443` leg fail safely rather than leak — you built the thing that contained this.
4. **Report the result and stop.** If TETA+PI has not acted by the time you have nothing else to do, say so plainly and stop. Do not invent a workaround.

## Boundaries
- Do NOT edit nginx, the origin certificate, DNS or anything in Cloudflare yourself. You have no sudo and no nginx access (D-004); the Cloudflare zone is the owner's and is shared with TETA+PI.
- Do NOT ask the owner to add a Configuration Rule pinning this hostname to Flexible — task 3 is the reasoning. Leave `bo-shos.` on the zone default (Full); it already is, which is exactly why it 525s instead of leaking.
- Do NOT ask the owner to flip the zone-wide **Always Use HTTPS** toggle. Forcing https for the back-office is wanted, but *after* the vhost lands and as a Redirect Rule **scoped to `bo-shos.hellfiresol.com`** — the zone also carries hellfire's apex and TETA+PI's API, so a zone-wide flip is not only ours to make. Your S1-04 addendum's finding stands: an origin-side `:80→https` redirect would loop under CF's Full topology, so this genuinely has to happen at the edge.
- Do NOT hand the back-office URL to the owner or anyone else, even once it returns 401. There is a second precondition that is not yours: the four seed logins still share `shosho-test-2026`, which is in this public repo's history. The owner must run `apps/backend/scripts/rotate-staging-passwords.mjs` first (S2-05). Verify the gate; do not announce the URL.
- Do NOT touch `apps/backend`, `apps/web`, `apps/backoffice` code.
- Do NOT create prod anything — the prod target is a separate proposal, now `proposed/S1-07-prod-target.md`, and S0 schedules it after S7 signs off.
- Never print a secret value, including basic-auth credentials.

## Done when
- [x] One message sent to `teta-pi-e0` covering both the vhost and the certificate reissue, with the measurements — **done in the S1-05 addendum**
- [ ] Either verified from outside with the `--resolve` + body-hash method and reported, or correctly reported as still waiting on them
- [ ] `:80` with Host `bo-shos` no longer returns TETA+PI's API — checked explicitly, because this is the one that would otherwise go unnoticed
- [ ] Unknown SNI still refused; hellfire's apex untouched; `shos.` unaffected
- [ ] PR `s1-06` merged

## Reporting
1. `/memory/log.md`: `## <date> — S1 DevOps — S1-06` — what you asked for, what you measured, in the table shape you used in the S1-05 addendum.
2. `/memory/state.md`: ONLY the S1 row.
3. Commits `[S1-06]`.
4. If you find a security issue outside your boundary, it goes straight to S7 (D-012) — tell S0, do not wait for routing.

## Next step
Proposals → `/memory/boots/proposed/`. Do not execute them. After reporting — stop and wait for S0.
