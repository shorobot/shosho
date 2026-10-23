"""The orchestrator loop: claim → run → close. Nothing more than a loop in this boot.

The sequence, and why each step is where it is:

1. **Day ceiling before dispatch** (§9.3: "summed across all runs/agents for the day before
   starting a new one"). If the day is already spent, nothing is claimed — claiming would start
   a run that must immediately fail.
2. **Claim** via ``claim_agent_tasks``, which *is* starting the run: migration 33 returns the
   run, not the task, so there is no window in which work is claimed but has no run row to log
   against. No second bookkeeping path is invented.
3. **Run** the agent, logging ordered lines to ``agent_run_logs`` as it goes, so S4's dashboard
   (C4) sees progress live rather than a result at the end.
4. **Close** via ``finish_agent_run``, always, with cost. A run that reports no cost is a blind
   spot in the dashboard, so the cost columns are passed on the success and failure paths
   alike.

The ``finally`` that closes the run is the important structural detail: an exception anywhere
in step 3 still closes the run as a failure with the spend recorded, so a crash cannot leave a
run open and a day's spend unaccounted.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import psycopg

from .agents import AccountingAgent
from .agents.base import Agent, AgentResult, RunContext
from .boundary import Tier, assert_autonomous
from .config import ConfigError, Settings, resolve_model
from .db import ClaimedRun, Database
from .ledger import CeilingExceeded, Ceilings, SpendLedger, ceilings_from_registry
from .llm import LlmGateway, default_client_factory

#: Every agent this orchestrator knows how to dispatch, keyed by ``agents.key``. One entry: the
#: boot is explicit that a second agent is not in scope (C6 Grow, C9 Warehouse, C10 Sales).
AGENTS: dict[str, Callable[[], Agent]] = {
    AccountingAgent.key: AccountingAgent,
}


@dataclass(slots=True)
class LoopReport:
    """What one pass of the loop did. Returned so the CLI can report without re-reading rows."""

    claimed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    cost_usd: str = "0"
    notes: list[str] = field(default_factory=list)


class Orchestrator:
    def __init__(self, settings: Settings, db: Database | None = None) -> None:
        self._settings = settings
        self._db = db or Database(settings.database_url)

    # ------------------------------------------------------------ public entry points
    def run_once(self) -> LoopReport:
        """Claim whatever is queued and run it. One pass, no sleeping, no scheduling."""
        report = LoopReport()
        with self._db.connect() as conn:
            identity = Database.whoami(conn)
            if identity.get("role") != "agent":
                # Not fatal in a local harness (a developer may be connected as postgres), but
                # it must never pass silently: the entire §9 boundary is a property of the role.
                report.notes.append(
                    f"WARNING: connected as {identity.get('role')!r}, not 'agent'. The §9.1 "
                    "boundary is enforced by the role's grants, so this is not a representative "
                    "run."
                )
            if identity.get("is_staff"):
                raise RuntimeError(
                    "is_staff() is true on this connection. The automation layer must never "
                    "hold staff authority (docs/security.md §9.1) — refusing to run."
                )

            day_spent = Database.day_spend_usd(conn)
            claims = Database.claim_agent_tasks(conn, self._settings.poll_limit)
            report.claimed = len(claims)
            if not claims:
                report.notes.append("nothing queued")
                return report

            for claim in claims:
                outcome = self._run_claim(conn, claim, day_spent)
                day_spent += outcome
                if outcome < 0:  # pragma: no cover - defensive, cost is never negative
                    continue
            # Recompute from the database rather than trusting the in-memory sum.
            report.cost_usd = str(Database.day_spend_usd(conn))
            report.succeeded, report.failed, report.skipped = self._tally(conn, claims)
        return report

    def run_scheduled(self, agent_key: str, payload: dict[str, Any]) -> str:
        """Open a run with no queued task behind it and execute one agent.

        ``agent_runs.task_id`` is nullable precisely for this (migration 34's comment), so a
        scheduled Accounting run needs nothing in the claim queue.
        """
        with self._db.connect() as conn:
            row = Database.agent_by_key(conn, agent_key)
            if row is None:
                raise ConfigError(f"no agents row with key {agent_key!r}")
            run_id = Database.open_unqueued_run(conn, row.id)
            claim = ClaimedRun(
                run_id=run_id,
                task_id=None,
                agent_id=row.id,
                customer_id=None,
                payload=payload,
                attempts=0,
            )
            day_spent = Database.day_spend_usd(conn)
            self._run_claim(conn, claim, day_spent)
            return run_id

    # ------------------------------------------------------------ one run
    def _run_claim(
        self,
        conn: psycopg.Connection[dict[str, Any]],
        claim: ClaimedRun,
        day_spent_before: Any,
    ) -> Any:
        """Execute one claimed run and close it. Returns the cost spent."""
        from decimal import Decimal

        def log(level: str, message: str) -> None:
            Database.log(conn, claim.run_id, level, message)

        ledger = SpendLedger(
            ceilings=Ceilings(Decimal("0"), Decimal("0"), "unresolved"),
            day_spent_before_run=Decimal(str(day_spent_before)),
        )
        ok = False
        conclusion: str | None = None
        error: str | None = None
        result: AgentResult | None = None
        gateway: LlmGateway | None = None

        try:
            agent_key = Database.agent_key_by_id(conn, claim.agent_id)
            log("info", f"run opened for agent {agent_key!r} (run {claim.run_id})")
            identity = Database.whoami(conn)
            log(
                "info",
                f"identity: current_user={identity.get('role')!r} "
                f"is_staff={identity.get('is_staff')!r} — policies keyed on "
                "current_user = 'agent' apply (docs/security.md §9.1)",
            )

            if agent_key is None or agent_key not in AGENTS:
                raise ConfigError(
                    f"no agent implementation for key {agent_key!r}; known: {sorted(AGENTS)}"
                )
            registry = Database.agent_by_key(conn, agent_key)
            if registry is None:  # pragma: no cover - the id came from this table
                raise ConfigError(f"agents row for {agent_key!r} disappeared")
            if not registry.active:
                # Seeded inactive by migration 33. Running an inactive agent anyway would make
                # the `active` flag decorative — and the role has no UPDATE to flip it.
                raise ConfigError(
                    f"agent {agent_key!r} is not active (agents.active = false). An operator "
                    "activates it; this role has no UPDATE grant on the registry."
                )

            agent = AGENTS[agent_key]()
            assert_autonomous(agent.tier, f"dispatch of agent {agent_key!r}")
            log("info", f"agent tier {agent.tier.value} (§9.5) — autonomous dispatch permitted")

            ledger.ceilings = ceilings_from_registry(registry.config)
            log(
                "info",
                f"ceilings: run=${ledger.ceilings.run_usd} day=${ledger.ceilings.day_usd} "
                f"source={ledger.ceilings.source}; day already spent "
                f"${ledger.day_spent_before_run}",
            )
            if ledger.day_spent_before_run >= ledger.ceilings.day_usd:
                raise CeilingExceeded(
                    "per-day",
                    ledger.day_spent_before_run,
                    Decimal("0"),
                    ledger.ceilings.day_usd,
                )

            model = resolve_model(registry.config)
            if self._settings.anthropic_api_key:
                gateway = LlmGateway(
                    client_factory=default_client_factory(self._settings.anthropic_api_key),
                    model=model,
                    ledger=ledger,
                    on_event=lambda kind, msg: log("info", f"[{kind}] {msg}"),
                )
                log("info", f"model {model} (from agents.config); gateway armed")
            else:
                log(
                    "warn",
                    f"model {model} selected but ANTHROPIC_API_KEY is unset (owner action D3) "
                    "— no model call will be issued this run",
                )

            ctx = RunContext(
                conn=conn,
                db=self._db,
                run_id=claim.run_id,
                agent_id=claim.agent_id,
                payload=claim.payload,
                log=log,
                ledger=ledger,
                gateway=gateway,
            )
            result = agent.run(ctx)

            for kind, payload in result.outputs:
                # Tier C is "promotes a draft into live state". Writing a `pending` draft is
                # Tier B, and the column grant makes that structural: `status` is not named.
                assert_autonomous(Tier.DRAFT, f"insert of {kind} output")
                output_id = Database.insert_output(
                    conn,
                    run_id=claim.run_id,
                    agent_id=claim.agent_id,
                    kind=kind,
                    payload=json.dumps(payload, ensure_ascii=False, default=str),
                )
                log(
                    "info",
                    f"wrote agent_outputs {output_id} kind={kind!r} status=pending — awaiting "
                    "review_agent_output() by owner/operator (§8.8b)",
                )
            for gap in result.gaps:
                log("warn", f"gap: {gap}")
            conclusion = result.conclusion
            ok = True
        except CeilingExceeded as exc:
            error = str(exc)
            conclusion = "refused: spend ceiling"
            log("error", error)
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            conclusion = "failed"
            log("error", error)
        finally:
            Database.finish_agent_run(
                conn,
                run_id=claim.run_id,
                ok=ok,
                conclusion=conclusion,
                error=error,
                input_tokens=0,
                output_tokens=0,
                cost_usd=ledger.run_spent,
                result=json.dumps(
                    {
                        "ok": ok,
                        "gaps": result.gaps if result else [],
                        "calls_refused": ledger.calls_refused,
                        "ceiling_source": ledger.ceilings.source,
                    },
                    ensure_ascii=False,
                ),
                final=False,
            )
            log(
                "info",
                f"run closed ok={ok} cost=${ledger.run_spent} refused_calls={ledger.calls_refused}",
            )
        return ledger.run_spent

    @staticmethod
    def _tally(
        conn: psycopg.Connection[dict[str, Any]], claims: list[ClaimedRun]
    ) -> tuple[int, int, int]:
        ids = [c.run_id for c in claims]
        rows = Database.fetch(
            conn,
            "select conclusion, error from public.agent_runs where id = any(%s::uuid[])",
            (ids,),
        )
        succeeded = sum(1 for r in rows if not r["error"])
        refused = sum(1 for r in rows if (r["conclusion"] or "").startswith("refused"))
        failed = len(rows) - succeeded - refused
        return succeeded, failed, refused
