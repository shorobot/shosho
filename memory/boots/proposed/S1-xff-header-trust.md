# PROPOSAL → S1 / owner: make `X-Forwarded-For` trustworthy before anything keys on it

Raised by TETA+PI's manager session 2026-10-17 after they closed the same hole on their own hosts.
**Measured by S0 against `main` (`acddb39`) rather than answered from memory.**

## The question they asked
Does the SH.OS app read `X-Forwarded-For` or `X-Real-IP` for anything — rate limiting, audit, abuse,
geo, session binding? Their vhosts for `shos.hellfiresol.com` and `bo-shos.hellfiresol.com` set **no**
`X-Forwarded-For`, so a client-supplied value reaches our app on `:8200`/`:8202` verbatim.

Their own numbers, from `api.tetapi.dev` before they fixed it: 130 requests with a **rotating** forged
header against a 120/60s limiter → **zero 429s**, the limiter was effectively absent. With one **fixed**
forged value → 429 at request 121, proving the forged value was the key. After the fix both modes → 429
at exactly 121.

## The answer, measured
**No on the header they asked about.** `grep -rniE 'x-forwarded-for|x-real-ip' apps/` returns **0** across
the whole repo. Nothing keys on a client IP: no rate limiter, no audit column, no geo, no session binding.
`grep -rniE 'ip_address|client_ip|remote_addr'` over all 34 migrations also returns **0**. `apps/web` reads
none of these headers at all. **So the bug class they measured does not exist here, and nothing is
currently exploitable through it.**

**Yes on two neighbouring headers, in one place.** `apps/backoffice/lib/csp.ts:98-104`'s
`isSecureContext()` reads:
```
if (headers.get("cf-ray") || headers.get("cf-connecting-ip")) return true;
const proto = (headers.get("x-forwarded-proto") ?? "").split(",")[0]!...
```
It decides whether to emit HSTS, `upgrade-insecure-requests` and the `Secure` cookie flag (S4-03).
`apps/web` has no equivalent.

**Exposure of that, stated honestly: effectively none today, and it is worth saying why rather than just
saying "low".** Forging `CF-Ray` or `X-Forwarded-Proto: https` makes the app treat *that request* as
secure, so it emits HSTS and `Secure` **on the response to the forger**. HSTS on a plaintext response is
ignored by browsers, and a `Secure` cookie the forger cannot then send back harms only the forger. There
is no cross-user effect, no authorization decision and no limiter to bypass. It also **fails closed** by
design (S4-03), which is the safe direction.

## The recommendation anyway: take the one-line fix
Not because something is broken, but because of what is queued. **D-018 is an accepted decision to
throttle `place_order`**, and `proposed/S2-rpc-throttling.md` and `proposed/S1-07-rate-limiting-owner-actions.md`
are both filed. A per-IP throttle is the single most likely future consumer of a client address, and if it
is written while the header is client-controlled we ship **exactly** TETA+PI's measured bug — a limiter
that reads as present and is absent. Making the header trustworthy now costs one line; discovering it
later costs what it cost them.

TETA+PI will apply it on the owner's word (the vhost is theirs; D-004 — we do not administer the host):
```
proxy_set_header X-Forwarded-For $remote_addr;
```

## The trap, which is already present in our own code shape
Use `$remote_addr`, which **overwrites** the client's value. Do **not** use
`$proxy_add_x_forwarded_for` — it **appends**, so a forged entry stays **first** and any consumer doing
`split(",")[0]` still reads the attacker's value. TETA+PI say that appending form is what bit them, and
that one of their own hosts (`stats.tetapi.dev`) is still on it.

**Worth noting for us specifically:** `csp.ts:101` already does `.split(",")[0]` on a forwarded header.
Harmless there for the reasons above — but it is the same shape, sitting in our codebase as the thing a
future session will copy. Whoever writes the throttle should read this file first.

## Also from the same message, not a security item
The live `shos.hellfiresol.com` vhost has drifted from TETA+PI's repo copy **by comments only** — the 5.17
`bo.shos.` → `bo-shos.` rename note was never copied up. Directives byte-identical. Mentioned so a future
diff is not misread as a config change.
