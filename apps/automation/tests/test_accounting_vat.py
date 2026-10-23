"""The VAT rule (D-019), which is the part of this agent that is easy to get wrong.

What these tests pin down:

* VAT comes from each order's own ``vat_cents`` — the amount actually charged, computed at
  order time from each item's own ``vat_delivery_pct``.
* No rate is ever assumed. 7 and 19 appear nowhere in a computation.
* Nothing branches on ``delivery`` vs ``pickup``: two orders identical but for their type
  produce identical tax figures.
* When the per-rate split is not derivable, the output says so instead of inventing one.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from conftest import FakeDb, FakeRefusal
from shosho_automation.agents import accounting
from shosho_automation.agents.accounting import (
    COMPLETED_STATUSES,
    AccountingAgent,
    resolve_period,
    resolve_vat_breakdown,
)
from shosho_automation.agents.base import RunContext


def order(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "00000000-0000-0000-0000-000000000001",
        "number": 1000,
        "status": "delivered",
        "type": "delivery",
        "payment_method": "card",
        "payment_status": "paid",
        "subtotal_cents": 10000,
        "discount_cents": 0,
        "delivery_fee_cents": 0,
        "tip_cents": 0,
        "total_cents": 10000,
        "vat_cents": 654,
        "payment_refunded_cents": 0,
        "contact_name": "Test",
        "courier_comment": None,
        "allergy_note": None,
    }
    base.update(over)
    return base


def ctx_with(db: FakeDb, log_fn: Any, payload: dict[str, Any] | None = None) -> RunContext:
    from decimal import Decimal

    from shosho_automation.ledger import Ceilings, SpendLedger

    return RunContext(
        conn=object(),  # type: ignore[arg-type] - FakeDb never touches it
        db=db,  # type: ignore[arg-type]
        run_id="run-1",
        agent_id="agent-1",
        payload=payload or {},
        log=log_fn,
        ledger=SpendLedger(Ceilings(Decimal("1"), Decimal("1"), "test")),
        gateway=None,
    )


# ---------------------------------------------------------------- the rate is never assumed
def test_vat_total_is_what_was_charged_not_a_recomputation() -> None:
    """A 7 % item and a 19 % item in the same period just sum their charged VAT."""
    orders = [
        order(id="a", vat_cents=654, total_cents=10000),  # 10000 gross at 7 %
        order(id="b", vat_cents=1597, total_cents=10000),  # 10000 gross at 19 %
    ]
    totals = AccountingAgent._totals(orders)
    assert totals["charged_vat_cents"] == 654 + 1597
    assert totals["gross_cents"] == 20000
    assert totals["net_cents"] == 20000 - (654 + 1597)


def test_order_type_does_not_change_the_tax_figures() -> None:
    """D-019: a pickup and a delivery order of the same item are taxed identically."""
    delivery = AccountingAgent._totals([order(type="delivery", vat_cents=654)])
    pickup = AccountingAgent._totals([order(type="pickup", vat_cents=654)])
    assert delivery["charged_vat_cents"] == pickup["charged_vat_cents"] == 654
    assert delivery["net_cents"] == pickup["net_cents"]


def test_tax_figures_depend_only_on_charged_amounts() -> None:
    """A guard against the exact regression the boot describes, asserted behaviourally.

    S4-05's boot asserted "pickup is 19 % from vat_onsite_pct" and both halves were false. An
    agent that "corrected" pickup to 19 % would add 12 points of tax to every Abholung order.
    So the property to hold is: the tax figures are a function of `total_cents` and `vat_cents`
    alone. Vary everything else — order type, payment method, item id, subtotal — and they must
    not move.
    """
    baseline = AccountingAgent._totals([order()])
    for variation in (
        {"type": "pickup"},
        {"type": "delivery"},
        {"payment_method": "cash"},
        {"payment_status": "authorized"},
        {"number": 9999},
        {"contact_name": "someone else"},
    ):
        varied = AccountingAgent._totals([order(**variation)])
        assert varied["charged_vat_cents"] == baseline["charged_vat_cents"], variation
        assert varied["net_cents"] == baseline["net_cents"], variation

    # And it *does* move when the charged VAT moves — otherwise the above proves nothing.
    assert AccountingAgent._totals([order(vat_cents=1597)])["charged_vat_cents"] == 1597


def test_no_issued_query_reads_the_dead_vat_onsite_column(log_fn) -> None:
    """D-019: `vat_onsite_pct` is read by nothing, and this agent must not be the first reader.

    Asserted against every statement a full run actually issues, rather than by searching the
    source — a source search also matches the prose explaining why the column is dead.
    """
    db = FakeDb(
        {
            "from public.settings": [{"value": {"name": "SHOSHO GmbH", "ust_id": "DE1"}}],
            "from public.orders\n": [order()],
            "menu_items": FakeRefusal("42501"),
        }
    )
    AccountingAgent().run(ctx_with(db, log_fn))
    assert db.queries, "the run issued no queries at all, so this proves nothing"
    for sql in db.queries:
        assert "vat_onsite_pct" not in sql, sql
    # The rate, where it is read at all, is the per-item delivery rate (D-019).
    assert any("vat_delivery_pct" in sql for sql in db.queries)


def test_by_type_is_labelled_informational_and_carries_no_tax() -> None:
    """The delivery/pickup split may exist as a channel mix — but never as a VAT split."""
    rows = AccountingAgent._by_type([order(type="delivery"), order(type="pickup")])
    for row in rows:
        assert set(row) == {"order_type", "orders", "gross_cents"}
        assert "vat" not in str(row).lower()


# ---------------------------------------------------------------- the breakdown fails closed
def test_breakdown_unavailable_when_postgres_refuses_the_menu_items_read(log_fn, logs) -> None:
    """Today's state: the `agent` role has no SELECT on menu_items, so there is no split."""
    db = FakeDb({"menu_items": FakeRefusal("42501")})
    breakdown = resolve_vat_breakdown(ctx_with(db, log_fn), ["a"])
    assert breakdown.available is False
    assert breakdown.by_rate == []
    assert "insufficient_privilege" in breakdown.reason
    assert "No rate has been assumed" in breakdown.reason
    assert any("unavailable" in msg for _lvl, msg in logs)


def test_breakdown_does_not_treat_an_empty_result_as_zero_vat(log_fn) -> None:
    """An RLS denial returns no rows. "No rows" must never read as "no VAT"."""
    db = FakeDb({"menu_items": []})
    breakdown = resolve_vat_breakdown(ctx_with(db, log_fn), ["a"])
    # No rows means no groups, so no rate claims anything — and the reason says the figure is
    # provisional rather than asserting a zero-VAT period.
    assert breakdown.by_rate == []
    assert breakdown.unattributed_vat_cents == 0


def test_breakdown_uses_the_rate_each_item_carries_when_it_can_be_read(log_fn) -> None:
    """The future state, once a rate is readable: the split is per item, from the data."""
    db = FakeDb(
        {
            "menu_items": [
                {"rate_pct": "7.00", "line_total_cents": 10000},
                {"rate_pct": "19.00", "line_total_cents": 11900},
            ]
        }
    )
    breakdown = resolve_vat_breakdown(ctx_with(db, log_fn), ["a"])
    assert breakdown.available is True
    rates = {row["rate_pct"]: row for row in breakdown.by_rate}
    assert rates["7.00"]["vat_cents"] == 654  # 10000 * 7/107
    assert rates["19.00"]["vat_cents"] == 1900  # 11900 * 19/119
    assert "provisional" in breakdown.reason
    assert "not snapshotted" in breakdown.reason


def test_breakdown_of_an_empty_period_is_explicit() -> None:
    breakdown = resolve_vat_breakdown(ctx_with(FakeDb({}), lambda _a, _b: None), [])
    assert breakdown.available is False
    assert "nothing to split" in breakdown.reason


# ---------------------------------------------------------------- basis and period
def test_completed_matches_the_repo_definition() -> None:
    """Must agree with report_revenue_by_day, or the back-office and the agent disagree."""
    assert COMPLETED_STATUSES == ("delivered", "picked_up")


def test_only_completed_orders_reach_the_totals() -> None:
    rows = [order(id="a", status="delivered"), order(id="b", status="cancelled")]
    completed = [o for o in rows if o["status"] in COMPLETED_STATUSES]
    assert AccountingAgent._totals(completed)["orders_completed"] == 1
    assert AccountingAgent._excluded(rows)["by_status"] == {"cancelled": 1}


def test_period_defaults_to_the_previous_calendar_month() -> None:
    period = resolve_period({}, today=dt.date(2026, 10, 21))
    assert (period.start, period.end) == (dt.date(2026, 9, 1), dt.date(2026, 9, 30))


def test_period_can_be_set_by_the_task_payload() -> None:
    period = resolve_period({"period_start": "2026-01-01", "period_end": "2026-03-31"})
    assert period.as_json() == {
        "start": "2026-01-01",
        "end": "2026-03-31",
        "timezone": "Europe/Berlin",
    }


def test_day_boundary_is_berlin_not_utc(log_fn) -> None:
    """A German bookkeeping period is a Berlin calendar month, not a UTC one.

    Asserted against the SQL actually issued, not against the source of the f-string that
    builds it.
    """
    assert accounting.BERLIN == "Europe/Berlin"
    db = FakeDb({})
    AccountingAgent()._read_orders(ctx_with(db, log_fn), resolve_period({}))
    assert len(db.queries) == 1
    assert "at time zone 'Europe/Berlin'" in db.queries[0]
