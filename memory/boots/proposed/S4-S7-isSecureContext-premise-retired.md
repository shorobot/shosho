# PROPOSAL → S4 (owner of the file) and S7 (D-012): TETA+PI's fix retired `isSecureContext()`'s premise

Filed by S0 2026-10-28, from TETA+PI's measured upstream-echo table. **This is an inference, clearly
labelled, not a measurement** — our only consumer sits behind the basic-auth gate, so S0 cannot observe
the app's response headers from outside. It should be confirmed by whoever can reach the container.

## What changed, outside our repo

TETA+PI now run, on both our vhosts, `:80` and `:443`:
```
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header CF-Connecting-IP $remote_addr;
```
`proxy_set_header` sets a header **unconditionally** on the upstream request. Their own echo-listener
measurement confirms the resulting values: an untrusted peer yields `CF-Connecting-IP: 127.0.0.1`
(forgery gone, not appended); a trusted CF peer yields the genuine client IP, because `$remote_addr` has
already been lifted out of that header by `real_ip_module` before `proxy_set_header` runs.

## The consequence for us

`apps/backoffice/lib/csp.ts:100`:
```ts
// Arrived through Cloudflare, so the public hop was https whatever the internal hop looks like.
if (headers.get("cf-ray") || headers.get("cf-connecting-ip")) return true;
```
**That comment's premise is now false.** `cf-connecting-ip` is present on *every* request reaching the app
through their nginx — including a direct-to-origin plaintext one — because nginx sets it either way. So
presence no longer means "arrived through Cloudflare"; it means "arrived through their nginx", which is
all production traffic. `isSecureContext()` therefore returns `true` unconditionally in that deployment.

**The direction is the safe one by the file's own stated criterion.** Its header says it fails closed on
purpose: *"a wrong `false` in production would put a staff session cookie on the wire in cleartext, while
a wrong `true` only costs a sign-in loop in local development."* This change moves it further toward
`true`, i.e. toward emitting HSTS, `upgrade-insecure-requests` and `Secure`. **Practical impact is
approximately nil**: all real traffic arrives via Cloudflare over https, the origin is not reachable by
ordinary users, and the ssh-tunnel verification path does not pass through nginx at all.

**The documented "residual gap" is also now closed, by accident.** The header block says a proxy
forwarding neither `Host` nor `X-Forwarded-Proto` nor any `CF-*` is indistinguishable from the ssh tunnel
and would be treated as loopback. Their nginx now always sends a `CF-*` header, so that case cannot arise
through the vhost.

## Why this is worth a change rather than a shrug
Nothing is broken. What is wrong is the **comment**, and in this codebase comments are load-bearing — a
future session reading it will believe the function still discriminates between CF and non-CF traffic in
production. It does not. S0's own D13 reply to TETA+PI leaned on exactly this function being
"presence-only"; that remains true, but *what the presence now proves* has changed.

## Suggested, not decided (S4 owns the file, S7 rules per D-012)
1. Update the comment to say what is now true: in the deployed topology this branch is always taken,
   because the origin sets the header unconditionally; it is retained for defence in depth and for
   deployments that do not.
2. Decide whether the branch should instead read `cf-ray` **only** — that header is *not* set by their
   nginx and so still carries the original meaning. This would restore the distinction at no cost. S0's
   recommendation, but it is S4's file and S7's ruling.
3. Confirm the inference from inside the container (anyone with the gate pair or tunnel access can read
   the request headers the app actually receives) before acting on it.
