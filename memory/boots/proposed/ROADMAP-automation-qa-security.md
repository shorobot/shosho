# ROADMAP — the automation layer (owner's items 5–7), as one ordered plan

Architecture and its consequences are **D-020**. This file is only the order of work and who does each
step. Nothing here is executed until S0 issues the boot for that step.

## The shape of it
Owner's items 6 (QA) and 7 (Security) are **not phases that follow 5** — they are continuous, and
treating them as a later stage is how both become theatre. S6 regresses the full
guest→order→back-office→agent path on each boot; S7 audits before any production deploy and owns the
privilege boundary in step 2 *before* code exists. Only item 5 is a sequence.

## The steps

| # | What | Who | Blocked by |
|---|---|---|---|
| 1 | Agent-run schema: queues, statuses, execution logs, RLS | **S2** | nothing — start here |
| 2 | Privilege boundary for `apps/automation` (service role + Anthropic key on the host) | **S7** | nothing — runs parallel to 1 |
| 3 | Orchestrator skeleton + **Accounting agent** (agent #1) | **S5** | 1 and 2 both |
| 4 | Agent dashboards in the back-office (status, queue, logs, realtime) | **S4** | 1 |
| 5 | Deploy surface for `apps/automation`: container, the two secrets, CI lane | **S1** | 2 · owner: Anthropic key |
| 6 | **Grow agent** (agent #2) | **S5** | 3 |
| 7 | FastAPI endpoints for Lieferando / Wolt | **S5** | 3 · owner: platform API access |
| 8 | Ingredient / recipe / stock schema (food cost) | **S2** | nothing, but large — do not start before 3 ships |
| 9 | **Warehouse agent** (agent #3) | **S5** | 8 |
| 10 | **Sales agent** — IG/FB DM lead-gen + order intake | **S5** | 3 · owner: Meta app + Business verification + Messaging permissions · a send transport (D-017) |
| 11 | **Quality agent** (computer vision) | **S5** | deferred by the owner; no spec yet |

## Why this order and not the owner's listed order
The agent list in the brief is ordered by commercial interest. The work is ordered by what is actually
reachable, and the two disagree sharply:

- **Sales is the most interesting and the most blocked.** Instagram/Facebook DM intake needs a Meta app,
  Business verification and reviewed Messaging permissions — owner-side, measured in weeks, and nothing a
  session can route around. It also needs a way to *reply*, which does not exist (D-017). Starting there
  would park S5 on an owner dependency for its entire first boot.
- **Accounting is agent #1 because it is unblocked and just got its ruling.** It reads orders, payments
  and the VAT model D-019 settled on 2026-10-15, needs no external credential, and produces something the
  owner's Steuerberater can actually use. Grow is a close second for the same reason.
- **Warehouse looks small and is not.** Food cost needs ingredients, recipes, yields and stock movements —
  none of which exist in 32 migrations. That is a schema design pass, not an agent.
- **Quality is correctly deferred** and has no spec; it should not be scoped until an agent is running.

## The dependency nobody will see coming
**Step 2 is the real gate, not step 1.** `apps/automation/.env.example` needs
`SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY`, and `_deploy.yml:150` records that D-013 deliberately
stopped rendering both to the server when the `api` placeholder was dropped. **Every app SHOSHO ships
today is anon-key only.** Automation is the first component to hold privileged credentials on the host, so
the trust boundary has to be designed before the orchestrator exists: what the service role may touch,
how the Anthropic key is scoped and rotated, what an agent may never do, and what happens when an agent
is wrong. Building the orchestrator first and fitting a boundary around it afterwards is the expensive
order, and it is the order that happens by default if step 2 is treated as paperwork.

## Owner actions this plan needs
1. **Anthropic API key** for the host — or a decision to reuse an existing one, which S7 should weigh in
   on in step 2 rather than S0 assuming.
2. **Lieferando / Wolt API access** before step 7. Both are partner-gated; worth starting early because
   the lead time is theirs, not ours.
3. **Meta app + Business verification + Messaging permissions** before step 10. The longest lead time in
   the whole plan — if Sales matters commercially, this is the one to start now even though the code is last.
4. Still outstanding from before and still blocking other things: **SMTP** (D-017), the **two Stripe
   secrets**, and **TETA+PI's basic-auth plaintext** (S1-08 / #88).

## What is deliberately not in this plan
- No visual/no-code orchestration tool. D-007 dropped n8n; D-020 extends that to "logic lives in code we own".
- No agent that messages a customer until a transport exists (D-017). Agents draft and write rows; they
  do not send.
- No separate observability product. Dashboards live in the back-office (D-020), one auth model, one
  design system, nothing extra to deploy.
- No client-side analytics for the Grow agent to read (D-015). It works from server-side data or says it
  cannot.
