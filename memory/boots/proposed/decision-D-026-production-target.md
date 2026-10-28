# PROPOSAL → owner: decide the production target (draft D-026)

Written by S0 2026-10-28, from measured infrastructure rather than recall. **D-004 deferred this in
September "after S7-01" and nobody returned to it**, which is why it has not moved — not because it is
hard, but because no one framed the choice.

## What we actually have today

| | Fact | Source |
|---|---|---|
| **Host** | DigitalOcean Frankfurt, `164.90.235.66`, **1 vCPU / 2 GB / 50 GB**, shared with TETA+PI and hellfire. We are an isolated co-tenant: **512 MB RAM hard cap**, 50 % CPU, ports `127.0.0.1:8200–8299`, **no sudo, no nginx** | `infra-access.md`, verified `memory.max=536870912` |
| **Prod on this box** | **Explicitly ruled out** — D-004: "Prod is NOT on this box — separate decision after S7-01" | D-004 |
| **Domain** | `shos.hellfiresol.com` + `bo-shos.hellfiresol.com`, both subdomains of **`hellfiresol.com`** | `infra-access.md` |
| **Supabase** | **Only `shosho-staging`** exists (`bvmitglwwqsvufetlkff`). No production project | measured |
| **Pipeline** | `deploy-prod.yml` exists and is correct: triggers on git tag `v*`, requires the GitHub Environment **"production"** with the **owner as required reviewer**. `remote_dir` and port are **placeholders**; it fails at the SSH step until `PROD_*` secrets exist | the workflow itself |

**So the pipeline is not the blocker. Four things it points at do not exist.**

## The domain — ANSWERED by the owner 2026-10-28, and it removes a blocker

**`hellfiresol.com` is the owner's own umbrella.** `infra-access.md` lists "hellfire" beside TETA+PI in a
way that reads like a third party; it is not. S0 asked rather than assumed, which was right — the two
readings had different consequences.

**What this settles:** there is no third-party dependency on our public hostnames. Staging can stay on
`shos.hellfiresol.com` indefinitely, and the Cloudflare zone is already the owner's, so DNS for any new
name is a change they can make themselves.

**What it does not settle, and it is now a product question rather than a blocker:** whether the
restaurant launches as `shos.hellfiresol.com` or on its own name. Customers type the address, read it on
receipts, and will see it in the `From:` of every e-mail the shop sends once SMTP exists (D4). A German
restaurant on a holding company's subdomain reads as a staging URL to the people it is for.

**S0's correction to its own advice, recorded because the first version was wrong:** the earlier draft
called the domain "the slowest item, start it first". **That was premised on not knowing who owned it.**
With the zone already in the owner's hands, registering e.g. a `.de` is same-day, not weeks. The domain is
now one of the *fastest* items on this path, and the long pole is elsewhere — see below.

## What production needs, concretely

1. **A domain** — above.
2. **A host.** Options below.
3. **A Supabase production project** — separate from staging (D-005). Straightforward once 2 is decided;
   the 36 migrations apply from scratch, which CI already proves it can do on PG 17.
4. **`PROD_*` secrets** in GitHub + the **"production" Environment** with the owner as reviewer.
5. **S7's pre-production audit** (F2) — and `S7-04`'s column-grant sweep must land first, because
   production would otherwise ship `menu_items.cost_cents` readable by `anon` (D-025).

## Host options

**A. A second DigitalOcean droplet, ours alone.** ~€12–24/month for 2 GB. We get root, so no co-tenancy
limits, no 512 MB cap, no asking TETA+PI for an nginx line. We also inherit everything that comes with
running a server: patching, TLS renewal, backups, monitoring. **S1 has already done this shape once** (the
staging deploy chain), so the work is known rather than exploratory.

**B. Managed platform (Fly / Railway / Render) for the two Next apps.** No server to run; deploys from the
same images. Costs more per month, and the pipeline needs rewriting away from SSH — `_deploy.yml` is built
around `ssh` + `docker compose`, so this is not a config change.

**C. Stay a co-tenant on the shared box.** **Rejected by D-004 and should stay rejected**: 512 MB for the
whole production stack, a neighbour's traffic competing for 1 vCPU, and an outage story that runs through
another company's administrator. It is also the one option where a mistake of ours can harm tetapi.dev.

**D. Vercel for the guest site only**, back-office and automation elsewhere. Splits the stack and the
pipeline for little gain while both apps are small.

## S0's recommendation: **A**, with the domain started first

Because the deploy pipeline already assumes it (SSH + compose + GHCR), because S1 has built exactly this
once, and because the cost difference against B is small next to the cost of rewriting the deploy path. B
is the better answer later, if the back-office ever needs to scale independently — it is not that yet.

**Sequence**, each item blocking only what follows it:
1. **Owner: choose the host** (A unless there is a reason for B). Now the first decision, since the domain
   turned out to be fast.
2. **Owner: register the launch domain** when the restaurant's public name is settled — same-day, the zone
   is already theirs. Not a blocker for 1, 3 or 4.
3. S1 provisions the host and fills `PROD_*` + the "production" Environment.
4. S7 runs F2, after `S7-04` lands.
5. First `v*` tag, owner approves the Environment gate, deploy.

## The actual long pole is not on this list, and it is already blocked on us
**D9** — the real 7 %/19 % rates, set with the Steuerberater — is the slowest thing between here and a
*legal* launch, because it needs an external human with their own calendar. **D9 is blocked on `S2-08`**
(the VAT-rate snapshot), which is written and issued but **not yet launched**. So the single
highest-leverage action available right now is launching that session: it unblocks a conversation that
runs on someone else's clock. Everything on the host path runs on ours.

**Not on this path and should not be allowed onto it:** customer accounts, push, marketing sends, agents,
Lieferando/Wolt, Meta. Guest ordering plus payments is a launchable product; the rest is after.

## What this proposal does NOT decide
- **Whether to launch at all, and when** — that is the owner's, and it depends on the restaurant being
  ready, not on us.
- **Stripe** (D5/D6). Independent of this: the keys can be obtained and a first live payment tested on
  **staging** before production exists, and probably should be, since the entire Stripe path has never
  been exercised once.
