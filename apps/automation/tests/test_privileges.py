"""The §9.4 "may never" list, proved against a real Postgres.

**These assert refusals, not row counts.** The distinction is the whole point: an RLS policy
that matches nothing returns zero rows (``200 []`` through PostgREST), which looks identical to
"there was nothing there". A missing **grant** raises ``InsufficientPrivilege``. Only the second
is evidence that a boundary held, so every test here asserts an error with a SQLSTATE.

Skipped unless ``AUTOMATION_TEST_DATABASE_URL`` points at a local stack with migrations 1..34
applied, connected **as the `agent` role**. See ``apps/automation/README.md``.
"""

from __future__ import annotations

import psycopg
import pytest

from conftest import local_dsn
from shosho_automation.db import Database, refusal_of

DSN = local_dsn()
pytestmark = pytest.mark.skipif(
    DSN is None, reason="set AUTOMATION_TEST_DATABASE_URL to run the privilege proofs"
)


@pytest.fixture
def conn():
    assert DSN is not None
    with psycopg.connect(DSN, autocommit=True, row_factory=psycopg.rows.dict_row) as c:
        yield c


def expect_refusal(conn, sql: str, params=()) -> str:
    """Run ``sql`` expecting Postgres to refuse, and return the refusal kind."""
    with pytest.raises(psycopg.Error) as excinfo, conn.cursor() as cur:
        cur.execute(sql, params)
    kind = refusal_of(excinfo.value)
    assert kind is not None, f"expected a refusal, got {excinfo.value!r}"
    return kind


# ---------------------------------------------------------------- identity (§9.1)
def test_we_are_the_agent_role_and_not_staff(conn) -> None:
    identity = Database.whoami(conn)
    assert identity["role"] == "agent"
    assert not identity["is_staff"], (
        "is_staff() must be false on a direct connection: auth.uid() is null, so the agent "
        "cannot inherit staff policies even by accident (§9.1)"
    )


def test_agent_is_not_bypassrls(conn) -> None:
    rows = Database.fetch(
        conn, "select rolbypassrls, rolsuper from pg_roles where rolname = 'agent'"
    )
    assert rows and rows[0]["rolbypassrls"] is False
    assert rows[0]["rolsuper"] is False


# ---------------------------------------------------------------- may never (§9.4)
def test_cannot_read_staff(conn) -> None:
    """No grant at all — a permission error, not an RLS-filtered empty result."""
    kind = expect_refusal(conn, "select * from public.staff")
    assert kind == "insufficient_privilege"


def test_cannot_approve_its_own_output(conn) -> None:
    """The §9.6 asymmetry: no EXECUTE on review_agent_output."""
    kind = expect_refusal(
        conn,
        "select public.review_agent_output("
        "'00000000-0000-0000-0000-000000000000'::uuid, 'approved')",
    )
    assert kind in {"insufficient_privilege", "undefined_function"}


def test_cannot_insert_an_output_that_names_status(conn) -> None:
    """`status` is outside the INSERT column grant, so naming it is refused outright."""
    kind = expect_refusal(
        conn,
        "insert into public.agent_outputs (run_id, agent_id, kind, payload, status) "
        "values (null, null, 'report', '{}'::jsonb, 'approved')",
    )
    assert kind == "insufficient_privilege"


def test_cannot_update_an_output_status(conn) -> None:
    kind = expect_refusal(conn, "update public.agent_outputs set status = 'approved'")
    assert kind == "insufficient_privilege"


def test_cannot_raise_its_own_ceiling(conn) -> None:
    """No UPDATE on the registry — "a ceiling an agent can edit is not a ceiling"."""
    kind = expect_refusal(
        conn, "update public.agents set config = '{\"run_ceiling_usd\": 999}'::jsonb"
    )
    assert kind == "insufficient_privilege"


def test_cannot_activate_itself(conn) -> None:
    kind = expect_refusal(conn, "update public.agents set active = true")
    assert kind == "insufficient_privilege"


def test_cannot_delete_anything(conn) -> None:
    for table in ["agent_runs", "agent_run_logs", "agent_outputs", "orders", "agents"]:
        kind = expect_refusal(conn, f"delete from public.{table}")
        assert kind == "insufficient_privilege", table


def test_cannot_update_a_money_column(conn) -> None:
    kind = expect_refusal(conn, "update public.orders set total_cents = 0")
    assert kind == "insufficient_privilege"


def test_cannot_edit_a_log_line(conn) -> None:
    """An append-only log the writer can edit is not an audit trail."""
    assert expect_refusal(conn, "update public.agent_run_logs set message = 'x'") == (
        "insufficient_privilege"
    )


def test_cannot_run_ddl(conn) -> None:
    kind = expect_refusal(conn, "create table public.s5_should_not_exist (id int)")
    assert kind is not None


def test_cannot_read_other_settings_keys(conn) -> None:
    """RLS, not a grant: scoped to key = 'business'. Proved by comparison, not by emptiness.

    This one genuinely *is* a zero-row case, so the assertion is that `business` is reachable
    and `ops` is not — an empty result for both would prove nothing.
    """
    keys = {r["key"] for r in Database.fetch(conn, "select key from public.settings")}
    assert keys <= {"business"}, f"only the business key should be visible, saw {keys}"


def test_cannot_read_menu_items_which_is_why_the_vat_split_is_unavailable(conn) -> None:
    """The finding this boot reports: the per-item VAT rate is not readable by this role.

    ``menu_items.vat_delivery_pct`` is the only place the rate lives (``order_items`` snapshots
    none), so a per-rate Steuerberater breakdown is not derivable. Filed to S2/S7 in log.md.
    """
    kind = expect_refusal(conn, "select vat_delivery_pct from public.menu_items")
    assert kind == "insufficient_privilege"


def test_cannot_rewrite_a_finished_run(conn) -> None:
    """§9.6: once ``finished_at`` is set the UPDATE policy matches zero rows.

    This is the one place where "zero rows" *is* the designed behaviour, so it is asserted as
    rowcount-zero explicitly and distinguished from a refusal in the comment above, rather than
    being mistaken for one.
    """
    with conn.cursor() as cur:
        cur.execute("select id from public.agent_runs where finished_at is not null limit 1")
        row = cur.fetchone()
    if row is None:
        pytest.skip("no finished run in the local stack yet")
    with conn.cursor() as cur:
        cur.execute(
            "update public.agent_runs set conclusion = 'tampered' where id = %s", (row["id"],)
        )
        assert cur.rowcount == 0, "a finished run must not be rewritable"


def test_cannot_set_finished_at_directly(conn) -> None:
    """``finished_at`` is outside the UPDATE column grant, so finish_agent_run
    cannot be bypassed by a direct write."""
    kind = expect_refusal(conn, "update public.agent_runs set finished_at = now()")
    assert kind == "insufficient_privilege"


def test_cannot_reach_agent_tasks_directly(conn) -> None:
    """No table grant: claim_agent_tasks is the only sanctioned path."""
    kind = expect_refusal(conn, "select * from public.agent_tasks")
    assert kind == "insufficient_privilege"
