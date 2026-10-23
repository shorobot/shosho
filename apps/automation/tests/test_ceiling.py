"""The spend ceiling, and the ordering §9.3 requires.

The assertion that matters is not "a ceiling exists" but "the check happens before the money is
spent". That is proved by trace order, and by the refused case appending no model call at all.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from conftest import FakeClient, RecordingMessages, make_ledger
from shosho_automation.config import DEFAULT_MODEL
from shosho_automation.ledger import CeilingExceeded, cost_of, estimate_cost
from shosho_automation.llm import LlmGateway


def build(trace: list[str], **ledger_kwargs: str) -> tuple[LlmGateway, RecordingMessages]:
    messages = RecordingMessages(trace=trace)
    ledger = make_ledger(trace, **ledger_kwargs)
    gateway = LlmGateway(
        client_factory=lambda: FakeClient(messages),
        model=DEFAULT_MODEL,
        ledger=ledger,
        on_event=lambda _kind, _msg: None,
    )
    return gateway, messages


def test_ceiling_is_checked_before_the_call() -> None:
    trace: list[str] = []
    gateway, messages = build(trace)
    gateway.complete(system="s", user_content="u")
    assert trace == ["ceiling-check", "model-call"], trace
    assert len(messages.calls) == 1


def test_refused_call_is_never_issued() -> None:
    """A ceiling already reached must produce zero requests, not a request then an error."""
    trace: list[str] = []
    gateway, messages = build(trace, run_usd="0.000002")
    with pytest.raises(CeilingExceeded) as excinfo:
        gateway.complete(system="s" * 10_000, user_content="u" * 10_000)
    assert excinfo.value.scope == "per-run"
    assert trace == ["ceiling-check"], trace
    assert messages.calls == [], "a refused call must not reach the client at all"


def test_day_ceiling_refuses_even_when_run_ceiling_has_room() -> None:
    trace: list[str] = []
    gateway, messages = build(trace, run_usd="100.00", day_usd="1.00", day_spent="0.999999")
    with pytest.raises(CeilingExceeded) as excinfo:
        gateway.complete(system="s", user_content="u")
    assert excinfo.value.scope == "per-day"
    assert messages.calls == []


def test_second_call_is_refused_once_the_run_total_crosses() -> None:
    """The running total must accumulate: call one succeeds, call two is refused."""
    trace: list[str] = []
    # One call at 1000 in / 200 out on Sonnet 5 costs 0.002 + 0.002 = $0.004.
    gateway, messages = build(trace, run_usd="0.0045")
    gateway.complete(system="s", user_content="u", max_output_tokens=200)
    assert len(messages.calls) == 1
    with pytest.raises(CeilingExceeded):
        gateway.complete(system="s", user_content="u", max_output_tokens=200)
    assert len(messages.calls) == 1, "the second call must not have been issued"
    assert trace == ["ceiling-check", "model-call", "ceiling-check"]


def test_cost_is_recorded_from_the_response_not_the_estimate() -> None:
    trace: list[str] = []
    gateway, _ = build(trace)
    result = gateway.complete(system="s", user_content="u", max_output_tokens=4000)
    # 1000 input + 200 output on Sonnet 5 = $0.002 + $0.002.
    assert result.cost_usd == Decimal("0.004000")
    assert result.input_tokens == 1000
    assert result.output_tokens == 200


def test_estimate_is_pessimistic_relative_to_the_actual() -> None:
    """The pre-call estimate must not under-count the output it is guarding against."""
    estimate = estimate_cost(DEFAULT_MODEL, prompt_chars=3000, max_output_tokens=2000)
    actual = cost_of(DEFAULT_MODEL, input_tokens=1000, output_tokens=2000)
    assert estimate >= actual


def test_text_extraction_skips_thinking_blocks() -> None:
    trace: list[str] = []
    gateway, _ = build(trace)
    result = gateway.complete(system="s", user_content="u")
    assert result.text == "Zusammenfassung."
