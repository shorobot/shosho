"""Static configuration: the model allow-list, token prices, and the fallback ceilings.

Two rules this module exists to enforce:

1. **The model id is named, never invented** (boot task 8). ``ALLOWED_MODELS`` is the whole
   valid set; anything else fails closed in :func:`resolve_model`. The id is read from the
   registry row's ``config`` (``agents.config.model``) so a model change is an operator edit,
   not a code edit, and so no call site hardcodes one.
2. **The ceiling is not reachable from the agent.** ``agents.config`` is ``SELECT``-only for
   the ``agent`` role (migration 34 grants no ``UPDATE`` anywhere), and the fallbacks below are
   source code. There is deliberately **no environment variable** that raises a ceiling: env
   lives in the same ``.env`` the process already reads, which would make "raise your own
   ceiling" a one-line change rather than an operator action.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal
from typing import Final

# ---------------------------------------------------------------- models
# The valid ids, per the boot. Do not add a date suffix to an id that has none and do not
# invent one: an unknown id must fail closed rather than be sent to the API.
MODEL_SONNET_5: Final = "claude-sonnet-5"
MODEL_OPUS_5: Final = "claude-opus-5"
MODEL_HAIKU_4_5: Final = "claude-haiku-4-5-20251001"

ALLOWED_MODELS: Final[frozenset[str]] = frozenset(
    {
        MODEL_SONNET_5,
        MODEL_OPUS_5,
        MODEL_HAIKU_4_5,
        # The Anthropic model table also serves Haiku 4.5 under the undated id. Both forms are
        # accepted so a registry row written against either one works; neither is constructed.
        "claude-haiku-4-5",
    }
)

#: Accounting's default (boot task 8). Justified in log.md: this agent does no open-ended
#: reasoning — every figure it reports is computed in SQL and Python before the model is
#: called at all (see :mod:`shosho_automation.agents.accounting`), so the model's only job is
#: to write a short German-language commentary over numbers it is handed. Opus-tier reasoning
#: buys nothing on that task and costs 2.5x the input / output rate.
DEFAULT_MODEL: Final = MODEL_SONNET_5

#: USD per 1M tokens, (input, output). Used to turn `usage` into `agent_runs.cost_usd`, and to
#: price the pre-call estimate the ceiling is checked against.
MODEL_PRICES_USD_PER_MTOK: Final[dict[str, tuple[Decimal, Decimal]]] = {
    MODEL_OPUS_5: (Decimal("5.00"), Decimal("25.00")),
    MODEL_SONNET_5: (Decimal("2.00"), Decimal("10.00")),
    MODEL_HAIKU_4_5: (Decimal("1.00"), Decimal("5.00")),
    "claude-haiku-4-5": (Decimal("1.00"), Decimal("5.00")),
}

# ---------------------------------------------------------------- ceilings
#: Fallback per-run ceiling, used when the registry row carries none. `agents.config` is seeded
#: `{}` by migration 33, so this is the value in force until an operator sets one — it must
#: therefore be a real, conservative number rather than a placeholder.
DEFAULT_RUN_CEILING_USD: Final = Decimal("0.50")
#: Fallback per-day ceiling, summed across every run of every agent (§9.3).
DEFAULT_DAY_CEILING_USD: Final = Decimal("5.00")

#: Upper bound on a single completion. Also the output half of the pre-call estimate, so a
#: lower value here makes the estimate tighter rather than looser.
DEFAULT_MAX_OUTPUT_TOKENS: Final = 2000


class ConfigError(RuntimeError):
    """Raised when configuration is missing or not usable. Always fails the run closed."""


@dataclass(frozen=True, slots=True)
class Settings:
    """Process-level settings, read from the environment exactly once.

    ``anthropic_api_key`` is optional on purpose: it is the owner's action D3 and is not
    available yet (plan.md §D). With no key the Accounting agent still produces its figures —
    they are computed, not generated — and records that the narrative was skipped. See
    :mod:`shosho_automation.agents.accounting`.
    """

    database_url: str
    anthropic_api_key: str | None
    poll_limit: int = 5

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        src = os.environ if env is None else env
        url = src.get("AUTOMATION_DATABASE_URL", "").strip()
        if not url:
            raise ConfigError(
                "AUTOMATION_DATABASE_URL is not set. This process connects as the dedicated "
                "`agent` Postgres role (docs/security.md §9.1); there is no service_role "
                "fallback by design."
            )
        key = src.get("ANTHROPIC_API_KEY", "").strip() or None
        raw_limit = src.get("AUTOMATION_POLL_LIMIT", "5").strip() or "5"
        try:
            limit = int(raw_limit)
        except ValueError as exc:  # pragma: no cover - defensive
            raise ConfigError(f"AUTOMATION_POLL_LIMIT is not an integer: {raw_limit!r}") from exc
        return cls(database_url=url, anthropic_api_key=key, poll_limit=max(1, limit))


def resolve_model(registry_config: dict[str, object]) -> str:
    """Return the model id for this agent, from the registry row's ``config``.

    Fails closed on an unknown id: a typo must not reach the API as a 404 after the ceiling
    has already been checked and the run has started spending.
    """
    raw = registry_config.get("model", DEFAULT_MODEL)
    if not isinstance(raw, str) or not raw:
        raise ConfigError(f"agents.config.model must be a non-empty string, got {raw!r}")
    if raw not in ALLOWED_MODELS:
        raise ConfigError(
            f"agents.config.model={raw!r} is not a known Claude model id. "
            f"Valid ids: {sorted(ALLOWED_MODELS)}"
        )
    return raw


def price_for(model: str) -> tuple[Decimal, Decimal]:
    """USD per 1M (input, output) tokens for ``model``; raises for an unpriced model.

    An unpriced model is a refusal rather than a zero: a model whose cost we cannot compute
    would report ``cost_usd`` of 0 for every run, which §9.3 calls a blind spot and the
    dashboard would read as "free".
    """
    try:
        return MODEL_PRICES_USD_PER_MTOK[model]
    except KeyError as exc:
        raise ConfigError(
            f"no token price recorded for model {model!r}; refusing to run a model whose "
            "cost cannot be reported"
        ) from exc
