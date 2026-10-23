"""The spend ceiling (``docs/security.md`` §9.3).

The ruling is specific about the order: the ceiling is checked **before** a model call,
"because a ceiling that only checks after the money is spent is not a ceiling". That ordering
is enforced structurally rather than by convention — :class:`SpendLedger` is the only object
that holds the running cost, and :class:`shosho_automation.llm.LlmGateway` is the only object
that holds an Anthropic client. The gateway cannot issue a call without first calling
:meth:`SpendLedger.check_before_call`, because the client is private to the gateway and the
gateway's one public method does the check on its first line.

Two ceilings, both from §9.3:

* **per run** — the running cost of the current run, read from the registry row.
* **per day** — every run of every agent since Berlin midnight, summed from ``agent_runs``
  before the loop dispatches, then kept current in memory as this run spends.

Failing the ceiling raises :class:`CeilingExceeded`, which the orchestrator turns into a
**failed, closed** run — never a run left open, and never a call issued anyway.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

from .config import price_for

#: ``agent_runs.cost_usd`` is ``numeric(12,6)``; quantize to match so what we check is what
#: the database will store, with no silent rounding between the two.
COST_QUANTUM: Final = Decimal("0.000001")


class CeilingExceeded(RuntimeError):
    """A model call was refused because it would cross a ceiling.

    Carries the numbers so the refusal is auditable in ``agent_run_logs`` rather than being a
    bare "denied" — a ceiling nobody can see firing gets raised to make an error go away.
    """

    def __init__(self, scope: str, spent: Decimal, estimate: Decimal, ceiling: Decimal) -> None:
        self.scope = scope
        self.spent = spent
        self.estimate = estimate
        self.ceiling = ceiling
        super().__init__(
            f"{scope} spend ceiling would be exceeded: already spent ${spent} + estimated "
            f"${estimate} > ceiling ${ceiling}. Call refused before it was issued."
        )


def quantize_cost(value: Decimal) -> Decimal:
    """Round to the 6 decimal places ``agent_runs.cost_usd`` stores."""
    return value.quantize(COST_QUANTUM, rounding=ROUND_HALF_UP)


def cost_of(model: str, input_tokens: int, output_tokens: int) -> Decimal:
    """USD cost of a completion, from the per-model token prices."""
    price_in, price_out = price_for(model)
    million = Decimal(1_000_000)
    total = (Decimal(input_tokens) / million) * price_in + (
        Decimal(output_tokens) / million
    ) * price_out
    return quantize_cost(total)


def estimate_cost(model: str, prompt_chars: int, max_output_tokens: int) -> Decimal:
    """A deliberately pessimistic pre-call cost estimate.

    Output is priced at the full ``max_output_tokens`` — a real upper bound, since the API
    cannot return more. Input is estimated from prompt length at 3 characters per token, which
    over-counts for ordinary text (~4 is typical) on purpose: the estimate's only job is to be
    an over-estimate, so the ceiling fires early rather than late. Counting input exactly would
    mean a ``count_tokens`` round trip before every call, which buys precision in the one
    direction that does not matter.
    """
    approx_input_tokens = max(1, prompt_chars // 3)
    return cost_of(model, approx_input_tokens, max_output_tokens)


@dataclass(frozen=True, slots=True)
class Ceilings:
    """The two ceilings in force for a run, and where they came from.

    ``source`` is carried so the run log can say whether an operator set these or whether the
    code fallback is in force — ``agents.config`` is seeded ``{}`` by migration 33, so "the
    default is active" is the expected state today, not an anomaly, and the log should say which
    it was rather than leaving a reader to guess.
    """

    run_usd: Decimal
    day_usd: Decimal
    source: str


@dataclass(slots=True)
class SpendLedger:
    """Running spend for one run, plus the day's spend before it started.

    The agent cannot widen this: ``run_usd``/``day_usd`` come from a row the ``agent`` role has
    no ``UPDATE`` grant on, and nothing on this object sets them.
    """

    ceilings: Ceilings
    day_spent_before_run: Decimal = Decimal("0")
    run_spent: Decimal = field(default=Decimal("0"))
    calls_refused: int = field(default=0)

    @property
    def day_spent(self) -> Decimal:
        """Day spend including this run so far."""
        return self.day_spent_before_run + self.run_spent

    def check_before_call(self, estimate: Decimal) -> None:
        """Raise :class:`CeilingExceeded` if a call costing ``estimate`` must not be issued.

        Called by :class:`shosho_automation.llm.LlmGateway` before every model call, and by
        nothing else. The run ceiling is checked first so the error names the tighter bound.
        """
        if self.run_spent + estimate > self.ceilings.run_usd:
            self.calls_refused += 1
            raise CeilingExceeded("per-run", self.run_spent, estimate, self.ceilings.run_usd)
        if self.day_spent + estimate > self.ceilings.day_usd:
            self.calls_refused += 1
            raise CeilingExceeded("per-day", self.day_spent, estimate, self.ceilings.day_usd)

    def record(self, model: str, input_tokens: int, output_tokens: int) -> Decimal:
        """Add an actual completion's cost to the run's running total; returns that cost."""
        spent = cost_of(model, input_tokens, output_tokens)
        self.run_spent = quantize_cost(self.run_spent + spent)
        return spent


def ceilings_from_registry(registry_config: dict[str, object]) -> Ceilings:
    """Read the ceilings out of ``agents.config``, falling back to the code defaults.

    A value that is present but unusable (a string, a negative number) is an error, not a
    reason to fall back — falling back there would turn "ceiling misconfigured" into "ceiling
    quietly replaced with the default", which is the failure mode §9.3 is about.
    """
    from .config import DEFAULT_DAY_CEILING_USD, DEFAULT_RUN_CEILING_USD, ConfigError

    def read(key: str, fallback: Decimal) -> tuple[Decimal, bool]:
        if key not in registry_config:
            return fallback, False
        raw = registry_config[key]
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            raise ConfigError(f"agents.config.{key} must be a number, got {raw!r}")
        try:
            value = Decimal(str(raw))
        except Exception as exc:
            raise ConfigError(f"agents.config.{key} is not a number: {raw!r}") from exc
        if value <= 0:
            raise ConfigError(f"agents.config.{key} must be > 0, got {value}")
        return value, True

    run_usd, run_set = read("run_ceiling_usd", DEFAULT_RUN_CEILING_USD)
    day_usd, day_set = read("day_ceiling_usd", DEFAULT_DAY_CEILING_USD)
    if run_set and day_set:
        source = "registry"
    elif run_set or day_set:
        source = "registry (partial; the unset ceiling uses the code default)"
    else:
        source = "code default (agents.config carries no ceiling)"
    return Ceilings(run_usd=run_usd, day_usd=day_usd, source=source)
