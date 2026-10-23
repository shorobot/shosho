"""The only path to the Anthropic API.

The ordering §9.3 requires — ceiling, then call — is a property of this file's structure: the
client is private to :class:`LlmGateway`, and :meth:`LlmGateway.complete` checks the ledger on
its first statement. There is no second place in the package that constructs an Anthropic
client, so there is no path to a model call that skips the check.

``apps/automation/tests/test_ceiling.py`` proves the order by observation rather than by
reading this code: a fake client and the ledger append to one shared list, and the test asserts
the check is recorded before the call, and that a refused call appends nothing at all.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from .config import DEFAULT_MAX_OUTPUT_TOKENS
from .ledger import SpendLedger, estimate_cost


class MessagesClient(Protocol):
    """The sliver of the Anthropic SDK this package uses.

    Narrow on purpose: it keeps the fake in the tests honest (it cannot accidentally implement
    more than production uses) and keeps the SDK surface in one place.
    """

    def create(self, **kwargs: Any) -> Any: ...


class AnthropicLike(Protocol):
    @property
    def messages(self) -> MessagesClient: ...


@dataclass(frozen=True, slots=True)
class LlmResult:
    text: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    stop_reason: str | None


class LlmGateway:
    """Issues model calls, and refuses to issue one that would cross a ceiling."""

    def __init__(
        self,
        *,
        client_factory: Callable[[], AnthropicLike],
        model: str,
        ledger: SpendLedger,
        on_event: Callable[[str, str], None],
    ) -> None:
        self._client_factory = client_factory
        self._client: AnthropicLike | None = None
        self._model = model
        self._ledger = ledger
        self._on_event = on_event

    @property
    def model(self) -> str:
        return self._model

    def complete(
        self,
        *,
        system: str,
        user_content: str,
        max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
    ) -> LlmResult:
        """Check the ceiling, then call the model, then record what it cost.

        Raises :class:`shosho_automation.ledger.CeilingExceeded` **before** any request is
        issued if the estimated cost would cross the per-run or per-day ceiling.
        """
        # (1) BEFORE the call — §9.3. Nothing above this line touches the network.
        estimate = estimate_cost(self._model, len(system) + len(user_content), max_output_tokens)
        self._on_event(
            "ceiling-check",
            f"model={self._model} estimate=${estimate} run_spent=${self._ledger.run_spent} "
            f"run_ceiling=${self._ledger.ceilings.run_usd} "
            f"day_spent=${self._ledger.day_spent} day_ceiling=${self._ledger.ceilings.day_usd}",
        )
        self._ledger.check_before_call(estimate)

        # (2) The call itself. No tools are passed — this agent's model has no way to act
        # (§9.5): it returns text, and the text is stored, never parsed into an action.
        if self._client is None:
            self._client = self._client_factory()
        self._on_event("model-call", f"issuing call to {self._model}")
        response = self._client.messages.create(
            model=self._model,
            max_tokens=max_output_tokens,
            system=system,
            messages=[{"role": "user", "content": user_content}],
            thinking={"type": "adaptive"},
        )

        # (3) AFTER the call — the actual cost, from the response's own usage figures.
        usage = getattr(response, "usage", None)
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        spent = self._ledger.record(self._model, input_tokens, output_tokens)
        self._on_event(
            "model-cost",
            f"in={input_tokens} out={output_tokens} cost=${spent} "
            f"run_total=${self._ledger.run_spent}",
        )
        return LlmResult(
            text=_text_of(response),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=spent,
            stop_reason=getattr(response, "stop_reason", None),
        )


def _text_of(response: Any) -> str:
    """Concatenate the ``text`` blocks of a response.

    ``content`` is a discriminated union — thinking blocks are present on an adaptive-thinking
    model and carry no ``.text``, so the block type is checked rather than index 0 being
    assumed to be text.
    """
    parts: list[str] = []
    for block in getattr(response, "content", None) or []:
        if getattr(block, "type", None) == "text":
            parts.append(str(getattr(block, "text", "")))
    return "\n".join(parts).strip()


def default_client_factory(api_key: str) -> Callable[[], AnthropicLike]:
    """Build a factory for the real SDK client, imported lazily.

    Lazy so the orchestrator, the tests and the FastAPI health endpoint all import cleanly in
    an environment with no API key — which is today's environment, since the key is the owner's
    action D3 and is not provisioned yet.
    """

    def factory() -> AnthropicLike:
        import anthropic

        return anthropic.Anthropic(api_key=api_key)  # type: ignore[return-value]

    return factory
