"""The Accounting agent — a Steuerberater-shaped summary of a period (D-020 agent #1).

**Tier B** (§9.5): it reads our own tables and writes one draft row. It sends nothing (D-017)
and writes nothing to ``orders`` or ``payment_*`` — §9.1 is explicit that its output is a
report, not a write to the live schema, and the ``agent`` role has no grant that would let it
be one.

**The VAT rule, which is the part that is easy to get wrong (D-019).** The rate is a property
of the **item** (``menu_items.vat_delivery_pct``), not of the order type. A pickup order and a
delivery order of the same item are taxed identically; ``vat_onsite_pct`` is read by nothing.
So this module:

* never assumes 7, never assumes 19, and never branches on ``delivery`` vs ``pickup``;
* reports ``orders.vat_cents`` — the VAT the order was **actually charged**, computed at order
  time from each item's own rate — as the authoritative figure;
* attempts a genuine per-rate breakdown, and when it cannot produce one, says so in the output
  instead of producing a plausible-looking split.

**Why the per-rate breakdown is unavailable today, and why that is reported rather than
worked around.** A German VAT return needs net and tax split by rate. That split cannot be
derived from the tables this role may read:

1. ``order_items`` snapshots no rate — it has ``item_id`` and no VAT column — so the rate is
   only reachable by joining ``menu_items``, which the ``agent`` role has **no SELECT grant
   on** (migration 34 grants ``orders``/``order_items``/``payment_events``/``payment_jobs``
   and deliberately not ``menu_items``).
2. Even with that grant the join would answer the wrong question: the rate is read **live** at
   order time (``rpc.sql:237``) and again on operator edit
   (``20260921000014_update_order_items.sql:119``), and it is mutable — owner action D9 is
   "set the real 7/19 rate per menu item with the Steuerberater". Joining today's
   ``menu_items`` would price a historical order at today's rate.
3. ``orders.vat_cents`` is a single blended integer that also contains the delivery fee's VAT,
   so the per-rate split cannot be recovered from it either.

Both are findings for S2/S7, filed in ``log.md``. The honest fix is a rate snapshot on
``order_items`` at order time; this agent is written to use a real breakdown the moment one is
derivable, and to refuse to invent one until then — :func:`resolve_vat_breakdown` is that
switch, and it reconciles whatever it computes against ``orders.vat_cents`` rather than
trusting its own join.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Final

from ..boundary import SYSTEM_PROMPT, Tier, wrap_untrusted
from ..db import refusal_of
from ..ledger import CeilingExceeded
from .base import AgentResult, RunContext

#: The repo's existing definition of a revenue-bearing order, matched exactly so this agent
#: cannot disagree with the back-office reports beside it (``report_revenue_by_day``,
#: ``20260926000024_reports.sql:102``).
COMPLETED_STATUSES: Final = ("delivered", "picked_up")

#: And its definition of a calendar day: Berlin local, not UTC (same migration, line 101).
BERLIN: Final = "Europe/Berlin"

OUTPUT_KIND: Final = "report"
OUTPUT_SCHEMA: Final = "shosho.accounting.period_summary.v1"


@dataclass(frozen=True, slots=True)
class Period:
    start: dt.date
    end: dt.date  # inclusive, Berlin calendar day

    def as_json(self) -> dict[str, str]:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(), "timezone": BERLIN}


def resolve_period(payload: dict[str, Any], today: dt.date | None = None) -> Period:
    """The period to report on: from the task payload, else the previous calendar month.

    Previous month rather than current, because a Steuerberater summary of a month still in
    progress is not a thing anyone files.
    """
    start_raw = payload.get("period_start")
    end_raw = payload.get("period_end")
    if isinstance(start_raw, str) and isinstance(end_raw, str):
        start = dt.date.fromisoformat(start_raw)
        end = dt.date.fromisoformat(end_raw)
        if end < start:
            raise ValueError(f"period_end {end} is before period_start {start}")
        return Period(start=start, end=end)
    anchor = today or dt.datetime.now(dt.UTC).date()
    first_of_this_month = anchor.replace(day=1)
    end = first_of_this_month - dt.timedelta(days=1)
    return Period(start=end.replace(day=1), end=end)


@dataclass(frozen=True, slots=True)
class VatBreakdown:
    """A per-rate VAT split, or an explicit statement that one is not derivable."""

    available: bool
    reason: str
    by_rate: list[dict[str, Any]]
    unattributed_vat_cents: int | None
    rate_source: str | None

    def as_json(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "reason": self.reason,
            "by_rate": self.by_rate,
            "unattributed_vat_cents": self.unattributed_vat_cents,
            "rate_source": self.rate_source,
        }


def resolve_vat_breakdown(ctx: RunContext, order_ids: list[str]) -> VatBreakdown:
    """Attempt a per-rate VAT split from the rates each order's items actually carry.

    Returns ``available=False`` with a reason when the rate cannot be read — which is the state
    today, and is a refusal from Postgres (``InsufficientPrivilege``), not an empty result. The
    distinction matters: an RLS denial returns zero rows and would be indistinguishable from
    "this period had no items", so this function must never treat "no rows" as "no VAT".
    """
    if not order_ids:
        return VatBreakdown(
            available=False,
            reason="no completed orders in the period, so there is nothing to split",
            by_rate=[],
            unattributed_vat_cents=None,
            rate_source=None,
        )
    try:
        rows = ctx.db.fetch(
            ctx.conn,
            """
            select mi.vat_delivery_pct::text as rate_pct,
                   sum(i.line_total_cents)::bigint as line_total_cents
              from public.order_items i
              join public.menu_items mi on mi.id = i.item_id
             where i.order_id = any(%s::uuid[])
             group by mi.vat_delivery_pct
             order by mi.vat_delivery_pct
            """,
            (order_ids,),
        )
    except Exception as exc:
        kind = refusal_of(exc)
        if kind is None:
            raise
        ctx.log(
            "warn",
            f"per-rate VAT breakdown unavailable: Postgres refused the read ({kind}). "
            "Reporting the charged VAT total without a rate split rather than assuming a rate.",
        )
        return VatBreakdown(
            available=False,
            reason=(
                f"the `agent` role may not read menu_items ({kind}), and order_items snapshots "
                "no VAT rate, so the rate each order was charged is not derivable from the "
                "tables this role may read. No rate has been assumed (D-019). "
                "See log.md S5-01: a rate snapshot on order_items is the fix."
            ),
            by_rate=[],
            unattributed_vat_cents=None,
            rate_source=None,
        )

    # The grant exists (a future state). Compute the split, but do not trust it blindly: the
    # rate is read live and is mutable, so a join can price a historical order at today's rate.
    # Reconcile against what was actually charged and report the residual rather than hiding it.
    by_rate: list[dict[str, Any]] = []
    derived_vat = 0
    for row in rows:
        rate = Decimal(str(row["rate_pct"]))
        gross = int(row["line_total_cents"])
        vat = int((Decimal(gross) * rate / (Decimal(100) + rate)).to_integral_value())
        derived_vat += vat
        by_rate.append(
            {
                "rate_pct": str(rate),
                "gross_cents": gross,
                "net_cents": gross - vat,
                "vat_cents": vat,
            }
        )
    return VatBreakdown(
        available=True,
        reason=(
            "derived from each item's current menu_items.vat_delivery_pct. The rate is not "
            "snapshotted at order time and is mutable, so this split is provisional: check it "
            "against charged_vat_cents before filing."
        ),
        by_rate=by_rate,
        unattributed_vat_cents=derived_vat,
        rate_source="menu_items.vat_delivery_pct (current value, not an order-time snapshot)",
    )


class AccountingAgent:
    """D-020 agent #1."""

    key = "accounting"
    tier = Tier.DRAFT

    def run(self, ctx: RunContext) -> AgentResult:
        period = resolve_period(ctx.payload)
        ctx.log("info", f"accounting period {period.start}..{period.end} ({BERLIN})")
        gaps: list[str] = []

        business = self._read_business(ctx, gaps)
        orders = self._read_orders(ctx, period)
        completed = [o for o in orders if o["status"] in COMPLETED_STATUSES]
        order_ids = [str(o["id"]) for o in completed]
        ctx.log(
            "info",
            f"{len(orders)} order(s) in period, {len(completed)} completed "
            f"(status in {COMPLETED_STATUSES})",
        )

        totals = self._totals(completed)
        vat = resolve_vat_breakdown(ctx, order_ids)
        if not vat.available and order_ids:
            gaps.append(vat.reason)
        elif vat.available and vat.unattributed_vat_cents is not None:
            residual = totals["charged_vat_cents"] - vat.unattributed_vat_cents
            vat = VatBreakdown(
                available=True,
                reason=vat.reason,
                by_rate=vat.by_rate,
                unattributed_vat_cents=residual,
                rate_source=vat.rate_source,
            )
            ctx.log(
                "info",
                f"per-rate VAT split derived; residual vs charged VAT = {residual} cents "
                "(contains the delivery fee's VAT, which is not derivable from granted reads)",
            )

        payments = self._payment_mix(ctx, order_ids)
        events = self._payment_events(ctx, order_ids)
        ctx.log("info", f"{len(payments)} payment-method group(s), {len(events)} event type(s)")

        report: dict[str, Any] = {
            "schema": OUTPUT_SCHEMA,
            "generated_for_review": True,
            "period": period.as_json(),
            "business": business,
            "basis": {
                "completed_orders": f"status in {list(COMPLETED_STATUSES)}",
                "calendar_day": f"(created_at at time zone '{BERLIN}')::date",
                "note": (
                    "Matches report_revenue_by_day so this summary cannot disagree with the "
                    "back-office reports."
                ),
                "vat_rule": (
                    "D-019: the VAT rate is a property of the item "
                    "(menu_items.vat_delivery_pct), not of the order type. charged_vat_cents is "
                    "the VAT each order was actually charged at order time. No rate is assumed "
                    "here and no figure branches on delivery vs pickup."
                ),
            },
            "totals": totals,
            "vat_breakdown_by_rate": vat.as_json(),
            "by_payment_method": payments,
            "payment_events": events,
            "excluded_from_totals": self._excluded(orders),
            "by_order_type_informational": self._by_type(completed),
            "gaps": gaps,
            "review": {
                "status": "pending",
                "note": (
                    "Written by an agent and not reviewed. Nothing downstream may treat this as "
                    "live before a human sets status = 'approved' via review_agent_output() "
                    "(api-contracts §8.8b)."
                ),
            },
        }

        narrative, narrative_status = self._narrative(ctx, report)
        report["narrative"] = narrative
        report["narrative_status"] = narrative_status

        conclusion = (
            f"accounting summary {period.start}..{period.end}: {totals['orders_completed']} "
            f"completed order(s), gross {totals['gross_cents']} cents, charged VAT "
            f"{totals['charged_vat_cents']} cents, per-rate split "
            f"{'derived' if vat.available else 'unavailable'}"
        )
        return AgentResult(conclusion=conclusion, outputs=[(OUTPUT_KIND, report)], gaps=gaps)

    # ------------------------------------------------------------ reads
    def _read_business(self, ctx: RunContext, gaps: list[str]) -> dict[str, Any]:
        """``settings`` is RLS-scoped to ``key = 'business'`` for this role (migration 34)."""
        rows = ctx.db.fetch(ctx.conn, "select value from public.settings where key = 'business'")
        if not rows:
            gaps.append(
                "settings['business'] returned no row. This role's policy is scoped to that one "
                "key, so an empty result means the row is absent — the VAT ID (ust_id) a "
                "Steuerberater summary should carry is therefore missing."
            )
            ctx.log("warn", "settings['business'] is empty — no ust_id on this report")
            return {"name": None, "ust_id": None}
        value = rows[0]["value"] or {}
        return {"name": value.get("name"), "ust_id": value.get("ust_id")}

    def _read_orders(self, ctx: RunContext, period: Period) -> list[dict[str, Any]]:
        return ctx.db.fetch(
            ctx.conn,
            f"""
            select id::text as id, number, status::text as status, type::text as type,
                   payment_method::text as payment_method, payment_status::text as payment_status,
                   subtotal_cents, discount_cents, delivery_fee_cents, tip_cents,
                   total_cents, vat_cents, payment_refunded_cents,
                   contact_name, courier_comment, allergy_note
              from public.orders
             where (created_at at time zone '{BERLIN}')::date between %s and %s
             order by number
            """,
            (period.start, period.end),
        )

    def _payment_mix(self, ctx: RunContext, order_ids: list[str]) -> list[dict[str, Any]]:
        if not order_ids:
            return []
        return ctx.db.fetch(
            ctx.conn,
            """
            select payment_method::text as payment_method,
                   payment_status::text as payment_status,
                   count(*)::int as orders,
                   sum(total_cents)::bigint as gross_cents,
                   sum(vat_cents)::bigint as charged_vat_cents
              from public.orders
             where id = any(%s::uuid[])
             group by payment_method, payment_status
             order by payment_method, payment_status
            """,
            (order_ids,),
        )

    def _payment_events(self, ctx: RunContext, order_ids: list[str]) -> list[dict[str, Any]]:
        if not order_ids:
            return []
        return ctx.db.fetch(
            ctx.conn,
            """
            select provider, type, count(*)::int as events
              from public.payment_events
             where order_id = any(%s::uuid[])
             group by provider, type
             order by provider, type
            """,
            (order_ids,),
        )

    # ------------------------------------------------------------ pure aggregation
    @staticmethod
    def _totals(completed: list[dict[str, Any]]) -> dict[str, Any]:
        """Sum the completed orders. Pure: no rate is applied, nothing is recomputed.

        ``charged_vat_cents`` is the sum of ``orders.vat_cents`` — what was charged, per each
        item's own rate, at order time. ``net_cents`` is gross minus that, which is arithmetic
        on a charged figure rather than an application of any rate.
        """

        def total(field: str) -> int:
            return sum(int(o[field] or 0) for o in completed)

        gross = total("total_cents")
        vat = total("vat_cents")
        return {
            "orders_completed": len(completed),
            "gross_cents": gross,
            "charged_vat_cents": vat,
            "net_cents": gross - vat,
            "subtotal_cents": total("subtotal_cents"),
            "discount_cents": total("discount_cents"),
            "delivery_fee_cents": total("delivery_fee_cents"),
            "tip_cents": total("tip_cents"),
            "refunded_cents": total("payment_refunded_cents"),
        }

    @staticmethod
    def _by_type(completed: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Gross by delivery/pickup — a channel mix, **not** a VAT split (D-019).

        Kept because it is useful to a bookkeeper and labelled ``informational`` because the
        one thing it must not become is the basis of a rate breakdown.
        """
        out: dict[str, dict[str, Any]] = {}
        for o in completed:
            row = out.setdefault(
                o["type"], {"order_type": o["type"], "orders": 0, "gross_cents": 0}
            )
            row["orders"] += 1
            row["gross_cents"] += int(o["total_cents"] or 0)
        return sorted(out.values(), key=lambda r: str(r["order_type"]))

    @staticmethod
    def _excluded(orders: list[dict[str, Any]]) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for o in orders:
            if o["status"] not in COMPLETED_STATUSES:
                counts[o["status"]] = counts.get(o["status"], 0) + 1
        return {
            "by_status": counts,
            "note": (
                "Orders not in a completed status are excluded from totals and listed here so "
                "the exclusion is visible rather than silent."
            ),
        }

    # ------------------------------------------------------------ the model call
    def _narrative(self, ctx: RunContext, report: dict[str, Any]) -> tuple[str | None, str]:
        """Ask the model for a short commentary. Never for a figure.

        This is the whole of this agent's model use, and it is why an injection cannot corrupt
        the report: the figures in ``report`` are already computed when this is called, the
        model is handed them as data, no tool is offered, and the reply is stored verbatim in
        one field. A failure here degrades the narrative and leaves every number intact.
        """
        if ctx.gateway is None:
            ctx.log(
                "info",
                "no Anthropic client configured (ANTHROPIC_API_KEY unset — owner action D3); "
                "figures are complete, narrative skipped",
            )
            return None, "skipped: no API key configured (plan.md D3)"

        # Row content the model sees is wrapped as data. `contact_name`, `courier_comment` and
        # `allergy_note` are free text typed by a customer or an operator — this is the only
        # part of the prompt that is not ours, and this is where it is quarantined.
        figures = {k: v for k, v in report.items() if k not in {"narrative", "narrative_status"}}
        user_content = (
            "Figures computed from the database, to describe:\n"
            + wrap_untrusted("accounting_period_summary", figures)
            + "\n\nWrite the commentary now, in German, following your rules."
        )
        try:
            result = ctx.gateway.complete(system=SYSTEM_PROMPT, user_content=user_content)
        except CeilingExceeded as exc:
            # The ceiling firing is not an agent failure: the figures stand. Record it loudly
            # and leave the narrative empty rather than retrying past a ceiling.
            ctx.log("warn", f"narrative skipped: {exc}")
            return None, f"skipped: {exc.scope} spend ceiling reached"
        except Exception as exc:
            ctx.log("warn", f"narrative failed: {type(exc).__name__}: {exc}")
            return None, f"failed: {type(exc).__name__}"
        ctx.log("info", f"narrative written ({len(result.text)} chars), ${result.cost_usd}")
        return result.text, "ok"
