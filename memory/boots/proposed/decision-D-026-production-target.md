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

## The question that has to be answered first, and it is not technical

**Whose domain is `hellfiresol.com`?** `infra-access.md` lists "hellfire" as a co-tenant alongside
TETA+PI, which reads as a third party — but HELLFIRE is also the owner's own portfolio umbrella covering
three projects, SHOSHO among them. **S0 does not know which, and will not assume.**

It matters either way, and the answer changes only *how awkward* it is:
- **If it is a third party's**: a restaurant cannot launch on someone else's domain at all.
- **If it is the owner's umbrella**: it still means the restaurant's public address is a subdomain of a
  holding-company name. Customers type it, see it in receipts, and it appears in every e-mail the shop
  ever sends.

Either way **SHOSHO has no domain of its own**, and nobody has raised that as an owner action. It has real
lead time — registration, DNS, a Cloudflare zone, and for e-mail later, SPF/DKIM. It should start before
the host decision, because it is slower and it blocks nothing else.

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
1. **Owner: answer the domain question**, then register/point the real one. Slowest, start now.
2. **Owner: choose the host** (A unless there is a reason for B).
3. S1 provisions it and fills `PROD_*` + the "production" Environment.
4. S7 runs F2, after `S7-04` lands.
5. First `v*` tag, owner approves the Environment gate, deploy.

**Not on this path and should not be allowed onto it:** customer accounts, push, marketing sends, agents,
Lieferando/Wolt, Meta. Guest ordering plus payments is a launchable product; the rest is after.

## What this proposal does NOT decide
- **Whether to launch at all, and when** — that is the owner's, and it depends on the restaurant being
  ready, not on us.
- **Stripe** (D5/D6). Independent of this: the keys can be obtained and a first live payment tested on
  **staging** before production exists, and probably should be, since the entire Stripe path has never
  been exercised once.
