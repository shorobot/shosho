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
`apps/web` has no equivalent — and neither does `apps/web/middleware.ts`; the single consumer in the whole
repo is this function, reached from `apps/backoffice/middleware.ts`.

**Read the two lines precisely, because a later draft of our reply to TETA+PI got this wrong and it was
the load-bearing sentence.** Line 100 tests `cf-ray` and `cf-connecting-ip` for **presence only** — their
*values* are never parsed, never split, never compared. The `.split(",")[0]` on line 101 is on
**`x-forwarded-proto`**, not on `cf-connecting-ip`. Measured 2026-10-21: `cf-connecting-ip` occurs exactly
**once** in the repo, as that truthiness test. So the honest statement of what forging `CF-Connecting-IP`
buys is "the forger's own response gains HSTS and `Secure`" — and nothing else.

**Exposure of that, stated honestly: effectively none today, and it is worth saying why rather than just
saying "low".** Forging `CF-Ray` or `X-Forwarded-Proto: https` makes the app treat *that request* as
secure, so it emits HSTS and `Secure` **on the response to the forger**. HSTS on a plaintext response is
ignored by browsers, and a `Secure` cookie the forger cannot then send back harms only the forger. There
is no cross-user effect, no authorization decision and no limiter to bypass. It also **fails closed** by
design (S4-03), which is the safe direction.

## The recommendation anyway: take the one-line fix — but as hygiene, not as a dependency
**CORRECTED 2026-10-21. The version of this section written on 10-17 was wrong, and the error was S0's.**
It claimed "a per-IP throttle is the single most likely future consumer of a client address" and leaned on
D-018 for urgency. Re-measured against the decision record and the code:

- **D-018 does not key on IP.** Its accepted text keys the `place_order` throttle on **phone and/or the
  guest session id**, naming both as client-supplied, and it **defers Option B** — routing guest RPCs
  through our own Next.js origin — with an explicit trigger (observed abuse, or the customer-accounts work
  reaching the ordering path). So the one accepted limiter will never read a client address.
- **The guest order does not pass through TETA+PI's nginx at all.** `apps/web` has **zero** route
  handlers, and `place_order` is called as `rpc('place_order')` from
  `components/checkout/CheckoutClient.tsx` — a client component. The request goes **browser → Supabase
  directly**. Whatever their vhost does to forwarded headers is not in that path. Only Option B would put
  it there.

So there is **no consumer of a client address today, and none queued**. What stands is narrower and still
worth asking for: the header is one we do read (presence-only, above), the fix is one line, and the trap
below is a real shape sitting in our codebase for a future session to copy. Ask for it as **hygiene ahead
of a deferred path, and say that plainly** — overstating it as a queued dependency is both false and, to a
party that has just measured the real version of this bug on their own hosts, needlessly expensive in
credibility.

**Whose hands this is in, which the 10-17 version left implicit.** D-004: user `shos`, **no sudo, no nginx
access**; `infra-access.md` lists `/etc/nginx` under "Do NOT touch" and notes **attempts are logged**, with
revocation available "instantly without notice". So this is a **request to TETA+PI, on the owner's word** —
never work we announce, perform, or claim to have verified from inside `/etc/nginx`. Anything we assert
about their configuration must be sourced to their own statements or to an outside probe of our own two
hostnames.

TETA+PI will apply it on the owner's word (the vhost is theirs; D-004 — we do not administer the host):
```
proxy_set_header X-Forwarded-For $remote_addr;
```

## The trap, which is already present in our own code shape
Use `$remote_addr`, which **overwrites** the client's value. Do **not** use
`$proxy_add_x_forwarded_for` — it **appends**, so a forged entry stays **first** and any consumer doing
`split(",")[0]` still reads the attacker's value. TETA+PI say that appending form is what bit them, and
that one of their own hosts (`stats.tetapi.dev`) is still on it.

**Worth noting for us specifically:** `csp.ts:101` already does `.split(",")[0]` on a forwarded header —
specifically on **`x-forwarded-proto`**, and *not* on any address header (see the precise reading above).
Harmless there for the reasons above — but it is the same shape, sitting in our codebase as the thing a
future session will copy. Whoever writes the throttle should read this file first.

## What was actually sent, 2026-10-21 — the ask grew to two headers
Recorded after the fact so this file matches the correspondence. The owner sent the reply on 2026-10-21.

**Asked for, both as hygiene and explicitly not as a live hole:**
1. `proxy_set_header X-Forwarded-For $remote_addr;` on both vhosts (the original one-liner).
2. **The same sanitisation for `CF-Connecting-IP`.** Rationale, stated to them in exactly these terms:
   by **their own** 10-17 statement their vhosts set no `X-Forwarded-For`, so a client value reaches our
   upstream verbatim; if `real_ip_header CF-Connecting-IP` rewrites only `$remote_addr`, a forged
   `CF-Connecting-IP` reaches it the same way on a direct-to-origin request. We **do** read that header —
   presence-only, `isSecureContext()` — so sanitising it is consistent hygiene.

**Two questions put back to them, both deliberately questions rather than assertions:**
- Does `real_ip_header CF-Connecting-IP` on their side overwrite only `$remote_addr`? **We hold no
  measurement of their nginx and must not take one** (`/etc/nginx` is do-not-touch, attempts logged), so
  this is theirs to answer. An earlier draft of our reply asserted it as "verified on the box"; that
  sentence was cut precisely because sending it would have read as a confession of breaching the
  co-tenancy terms to the party that logs them.
- Do they rely on `cf-ray` for anything beyond "came through CF"? Left **unsanitised** pending their
  answer: it is an opaque trace-id rather than an address, we read it presence-only too, and overwriting
  it with filler could be worse than passing it. Forging it has the same nil effect as `CF-Connecting-IP`.

**What we committed to:** once they apply it, we re-probe **our own two hostnames from outside** and
report — unknown SNI on `:443` and an invented `Host:` on `:80`, body hashes compared, per the standing
origin-check method. Nothing from inside their box, their repo, or their application.

**Status:** `plan.md` D13 is `[!]` — blocked on TETA+PI, no longer on the owner.

## Also from the same message, not a security item
The live `shos.hellfiresol.com` vhost has drifted from TETA+PI's repo copy **by comments only** — the 5.17
`bo.shos.` → `bo-shos.` rename note was never copied up. Directives byte-identical. Mentioned so a future
diff is not misread as a config change.
