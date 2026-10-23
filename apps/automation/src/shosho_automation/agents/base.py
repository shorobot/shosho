"""What an agent is, from the orchestrator's point of view.

Deliberately small: one agent exists (Accounting), and C6/C9/C10 will add more. The shape is
"read, compute, return a draft" — every agent declares the highest §9.5 tier it operates at,
and the orchestrator refuses to dispatch one that claims Tier C.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import psycopg

from ..boundary import Tier
from ..db import Database
from ..ledger import SpendLedger
from ..llm import LlmGateway


@dataclass(slots=True)
class RunContext:
    """Everything an agent is allowed to touch during one run.

    An agent gets no DSN and no API key: it gets an open connection whose role is already
    ``agent``, and a gateway whose ceiling has already been configured from a row it cannot
    write. It cannot widen its own access from in here.
    """

    conn: psycopg.Connection[dict[str, Any]]
    db: Database
    run_id: str
    agent_id: str
    payload: dict[str, Any]
    log: Callable[[str, str], None]
    ledger: SpendLedger
    gateway: LlmGateway | None


@dataclass(slots=True)
class AgentResult:
    """What an agent hands back. ``outputs`` become ``pending`` ``agent_outputs`` rows."""

    conclusion: str
    outputs: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)


@runtime_checkable
class Agent(Protocol):
    #: Must match an ``agents.key`` value seeded by migration 33.
    key: str
    #: The highest §9.5 tier this agent operates at. Tier C is never dispatched.
    tier: Tier

    def run(self, ctx: RunContext) -> AgentResult: ...
