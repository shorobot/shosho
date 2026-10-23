"""Model choice, the allow-list, and reading the ceiling out of the registry."""

from __future__ import annotations

from decimal import Decimal

import pytest

from shosho_automation.config import (
    ALLOWED_MODELS,
    DEFAULT_MODEL,
    MODEL_PRICES_USD_PER_MTOK,
    ConfigError,
    Settings,
    price_for,
    resolve_model,
)
from shosho_automation.ledger import ceilings_from_registry


def test_default_model_is_sonnet_5() -> None:
    assert DEFAULT_MODEL == "claude-sonnet-5"
    assert resolve_model({}) == "claude-sonnet-5"


def test_model_comes_from_the_registry_not_a_call_site() -> None:
    assert resolve_model({"model": "claude-opus-5"}) == "claude-opus-5"


def test_unknown_model_fails_closed() -> None:
    """An invented or typo'd id must not be sent to the API."""
    for bad in ["claude-sonnet-5-20260101", "claude-4-sonnet", "gpt-5", "", 7]:
        with pytest.raises(ConfigError):
            resolve_model({"model": bad})


def test_every_allowed_model_is_priced() -> None:
    """An unpriced model would report cost_usd = 0 for every run — a §9.3 blind spot."""
    for model in ALLOWED_MODELS:
        assert model in MODEL_PRICES_USD_PER_MTOK
        price_in, price_out = price_for(model)
        assert price_in > 0 and price_out > 0


def test_ceilings_default_when_registry_config_is_empty() -> None:
    """migration 33 seeds `config` as {} — the default must be a real, conservative number."""
    ceilings = ceilings_from_registry({})
    assert ceilings.run_usd == Decimal("0.50")
    assert ceilings.day_usd == Decimal("5.00")
    assert "code default" in ceilings.source


def test_ceilings_read_from_registry() -> None:
    ceilings = ceilings_from_registry({"run_ceiling_usd": "0.25", "day_ceiling_usd": 2})
    assert ceilings.run_usd == Decimal("0.25")
    assert ceilings.day_usd == Decimal("2")
    assert ceilings.source == "registry"


def test_unusable_ceiling_is_an_error_not_a_silent_default() -> None:
    """ "Misconfigured" must not degrade into "replaced with the default"."""
    for bad in [{"run_ceiling_usd": "abc"}, {"run_ceiling_usd": -1}, {"day_ceiling_usd": True}]:
        with pytest.raises(ConfigError):
            ceilings_from_registry(bad)


def test_settings_require_the_agent_dsn() -> None:
    with pytest.raises(ConfigError) as excinfo:
        Settings.from_env({})
    assert "AUTOMATION_DATABASE_URL" in str(excinfo.value)
    assert "service_role" in str(excinfo.value)


def test_settings_tolerate_a_missing_api_key() -> None:
    """The key is owner action D3 and is not provisioned; the figures must still be producible."""
    settings = Settings.from_env({"AUTOMATION_DATABASE_URL": "postgresql:///x"})
    assert settings.anthropic_api_key is None
