"""Shared fakes.

Everything here is a fake rather than a mock library: the point of these tests is to observe
*order* and *refusal*, and a hand-written recorder makes what is being asserted obvious.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import pytest

from shosho_automation.ledger import Ceilings, SpendLedger


@dataclass
class Usage:
    input_tokens: int
    output_tokens: int


@dataclass
class TextBlock:
    text: str
    type: str = "text"


@dataclass
class ThinkingBlock:
    thinking: str = "..."
    type: str = "thinking"


@dataclass
class FakeResponse:
    content: list[Any]
    usage: Usage
    stop_reason: str = "end_turn"


@dataclass
class RecordingMessages:
    """Stands in for ``client.messages``; appends to a shared trace when called."""

    trace: list[str]
    reply: str = "Zusammenfassung."
    input_tokens: int = 1000
    output_tokens: int = 200
    calls: list[dict[str, Any]] = field(default_factory=list)

    def create(self, **kwargs: Any) -> FakeResponse:
        self.trace.append("model-call")
        self.calls.append(kwargs)
        return FakeResponse(
            content=[ThinkingBlock(), TextBlock(self.reply)],
            usage=Usage(self.input_tokens, self.output_tokens),
        )


@dataclass
class FakeClient:
    messages: RecordingMessages


class TracingLedger(SpendLedger):
    """A ledger that records each ceiling check into the same trace as the model calls.

    This is how the §9.3 ordering is proved by observation: one list, two writers, and the
    assertion is on the sequence.
    """

    def __init__(self, trace: list[str], **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._trace = trace

    def check_before_call(self, estimate: Decimal) -> None:
        self._trace.append("ceiling-check")
        super().check_before_call(estimate)


def make_ledger(
    trace: list[str],
    run_usd: str = "1.00",
    day_usd: str = "10.00",
    day_spent: str = "0",
) -> TracingLedger:
    return TracingLedger(
        trace,
        ceilings=Ceilings(Decimal(run_usd), Decimal(day_usd), "test"),
        day_spent_before_run=Decimal(day_spent),
    )


class FakeRefusal(Exception):
    """A stand-in for a psycopg error carrying a SQLSTATE."""

    def __init__(self, sqlstate: str) -> None:
        super().__init__(f"refused with {sqlstate}")
        self.sqlstate = sqlstate


@dataclass
class FakeDb:
    """A ``Database``-shaped object whose ``fetch`` returns or raises per query fragment."""

    responses: dict[str, Any]
    queries: list[str] = field(default_factory=list)

    def fetch(self, _conn: Any, sql: str, params: Any = ()) -> list[dict[str, Any]]:
        self.queries.append(sql)
        for fragment, value in self.responses.items():
            if fragment in sql:
                if isinstance(value, Exception):
                    raise value
                return value  # type: ignore[no-any-return]
        return []


@pytest.fixture
def logs() -> list[tuple[str, str]]:
    return []


@pytest.fixture
def log_fn(logs: list[tuple[str, str]]):
    def _log(level: str, message: str) -> None:
        logs.append((level, message))

    return _log


def local_dsn() -> str | None:
    """DSN for the local verification stack, if this environment has one.

    The privilege tests need a real Postgres with migrations 1..34 applied, because the whole
    point is that *Postgres* refuses — asserting it in Python would prove nothing.
    """
    return os.environ.get("AUTOMATION_TEST_DATABASE_URL") or None
