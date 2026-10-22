# Proposal → S0 (and S5): a settled key shape for the spend ceiling in `agents.config`

From S4 Back-office, S4-06 (the agent dashboards, `/automation`). Not urgent, but a real gap worth
closing before a second write to `agents.config` happens — a disagreement here is cheap to fix now
and expensive once S5 and the dashboard have each shipped against a different assumption.

## The gap

`docs/security.md` §9.3 says the per-run and per-day spend ceiling live "held in `agents.config`" but
no agent had ever written to that column before S5-01 (Accounting, running in parallel with this
boot) — so there was no existing shape to read, and `docs/api-contracts.md` §8.8 does not name a key
either ("agent-specific tuning; S5's vocabulary, not specified here").

S4-06's dashboard needed something concrete to read (to show "approaching/over the ceiling") and the
Registry screen needed something concrete to write (an owner setting the number), so it picked one:

```ts
// agents.config shape this boot reads/writes
{
  ceiling_usd_per_run?: number;  // USD, whole-dollar granularity in the UI today
  ceiling_usd_per_day?: number;  // USD
}
```
Absence of a key means "no ceiling configured" — rendered as that sentence, never as `0` or as "ok."

## Why this needs a ruling rather than staying implicit

§9.3 also says the orchestrator (S5) must check the ceiling **before** each model call, in its own
dispatch loop, reading from the same `agents.config`. S5-01 was written and merged in parallel with
this boot — I never saw its code and could not coordinate live. If S5 picked a different key name (or
a different unit — cents instead of dollars, a single combined ceiling instead of per-run/per-day),
the orchestrator's enforcement and this dashboard's display will silently disagree about where the
number lives: an owner could set a ceiling here that does nothing, or S5's enforcement could read a
key this screen never shows.

## Ask

1. Confirm (or correct) the key names and units above against whatever S5-01 actually shipped.
2. If they already match — ratify it here so a future agent's boot has one place to look rather than
   re-deriving the shape from this screen's code.
3. If they don't match, whoever reconciles should update `docs/api-contracts.md` §8.8 to name the
   settled shape explicitly, so the next person (C6 Grow, C9 Warehouse) doesn't repeat this gap.

Not blocking: the dashboard renders "no ceiling configured" correctly either way, and nothing breaks
if the keys are renamed later — `agentConfigOf()`/`agentConfigToJson()` in
`apps/backoffice/lib/automation.ts` are the only two places that would need to change.
