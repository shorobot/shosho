# BOOT: S1-06 (DevOps) — one request to TETA+PI: put `bo-shos.hellfiresol.com` on the origin

## Role
You are session S1 (DevOps) of SHOSHO. One job: get the new back-office hostname onto the origin, then verify it from outside. This is a small boot — do not expand it. The edge half is already done and measured; only the origin half is missing.

## Context
Repo: https://github.com/shorobot/shosho. The root checkout `/Users/bobbob/BOB/SERVER/SH.OS.` is yours (D-008). `git fetch origin && git checkout -b s1-06 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s1-06` → `main`.
Read FIRST: `/memory/state.md` (the back-office hostname block), `/memory/infra-access.md` (how to reach `teta-pi-e0`, and the terms — we do not administer the host), and S0's log entries of 2026-10-05.

**What changed since S1-05.** The hostname was renamed. `bo.shos.hellfiresol.com` was two labels deep and Cloudflare's free Universal SSL certificate covers `hellfiresol.com` + `*.hellfiresol.com` only, so it could never complete a TLS handshake at the edge. The owner has already renamed the DNS record to **`bo-shos.hellfiresol.com`** (one label, proxied) and that half now works.

**State as measured by S0 on 2026-10-05, so you do not have to re-derive it:**

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
1. **Send TETA+PI one request, not two.** Ask `teta-pi-e0` for both halves in a single message, because either alone leaves the name broken:
   - add `bo-shos.hellfiresol.com` to the back-office vhost — **both the `:80` and the `:443` server blocks**, with the same basic-auth gate the old name has;
   - **reissue the Cloudflare Origin CA certificate** with SANs `shos.hellfiresol.com` + `bo-shos.hellfiresol.com`.
   Whether they keep `bo.shos.hellfiresol.com` on the certificate and the vhost is their call — we do not need it any more, and saying so is more useful to them than asking them to guess. Include the measurements above; they responded well to specifics in S1-05. Do not ask for anything else in this message — no cap increase, no SSL-mode change, nothing on the Cloudflare side (that is the owner's zone).
2. **Verify from outside when they report it done — do not take the report at face value.** Use the S1-05 method, which is the house standard for a reason: `curl --resolve <name>:443:164.90.235.66` so real SNI is sent, and **compare body hashes, not status codes** (S0 once read a 200 from a no-SNI probe as proof a name was served, and it was another tenant's page). Check, at minimum:
   - origin `:443` SNI `bo-shos` → nginx's own 401, and still 401 when wrong credentials are supplied, so the gate actually checks rather than decorating;
   - origin `:80` Host `bo-shos` → 401, **not** TETA+PI's API JSON — this is the specific regression to look for;
   - certificate SANs are exactly what was agreed, and hellfire's apex is still untouched (`CN=hellfiresol.com`, SAN apex+www, its own byte size);
   - unknown SNI is **still** refused at the handshake — confirm they did not reintroduce a default server block while editing;
   - `https://shos.hellfiresol.com/` unaffected: 200, the real SHOSHO page, and the only "hellfire" string in the body is our own `siteUrl`;
   - `https://bo-shos.hellfiresol.com/` through the edge → 401 from nginx, no longer 525.
3. **Report the result and stop.** If they have not acted by the time you have nothing else to do, say so plainly and stop — do not chase them twice, and do not invent a workaround.

## Boundaries
- Do NOT edit nginx, the origin certificate, DNS or anything in Cloudflare yourself. You have no sudo and no nginx access (D-004); the Cloudflare zone is the owner's and is shared with TETA+PI.
- Do NOT ask the owner to add a Configuration Rule pinning this hostname to Flexible. S0 struck that step from the owner's list in the same change that issued this boot — see the reasoning in `state.md`. Pinning `bo-shos` to Flexible would make Cloudflare fetch the origin over `:80`, where our name currently lands in TETA+PI's API, and serve that under `https://bo-shos.hellfiresol.com/` with a valid certificate. If anyone proposes it, say why not.
- Do NOT hand the back-office URL to the owner or anyone else, even once it returns 401. There is a second precondition that is not yours: the four seed logins still share `shosho-test-2026`, which is in this public repo's history. The owner must run `apps/backend/scripts/rotate-staging-passwords.mjs` first (S2-05). Verify the gate; do not announce the URL.
- Do NOT touch `apps/backend`, `apps/web`, `apps/backoffice` code.
- Do NOT create prod anything — the prod target is a separate proposal, now `proposed/S1-07-prod-target.md`, and S0 schedules it after S7 signs off.
- Never print a secret value, including basic-auth credentials.

## Done when
- [ ] One message sent to `teta-pi-e0` covering both the vhost and the certificate reissue, with the measurements
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
