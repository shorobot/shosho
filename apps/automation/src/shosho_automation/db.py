"""Postgres access as the ``agent`` role.

Every statement this process issues goes through here, as the dedicated ``agent`` role over a
direct connection (``AUTOMATION_DATABASE_URL``) — no PostgREST, never ``service_role``
(§9.1, §8.8a). S2-09 revoked ``service_role``'s ``EXECUTE`` on ``claim_agent_tasks`` and
``finish_agent_run`` so that the easy path is closed; nothing here tries to reopen it.

Consequences designed around rather than worked around:

* ``auth.uid()`` is null on this connection, so ``is_staff()`` is false for everything. The
  policies that apply are the ``current_user = 'agent'`` ones.
* An RLS denial returns zero rows, not an error (``200 []`` in PostgREST terms). A missing
  **grant** raises ``InsufficientPrivilege``. The two are different proofs and
  :func:`refusal_of` keeps them distinguishable, because "the query returned nothing" is not
  evidence that a boundary held.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import psycopg
from psycopg import errors as pg_errors
from psycopg.rows import dict_row

#: Postgres SQLSTATEs that mean "the role was refused", as opposed to "no rows matched".
REFUSAL_CODES: dict[str, str] = {
    "42501": "insufficient_privilege",
    "42P01": "undefined_table",
    "42883": "undefined_function",
}


def refusal_of(exc: BaseException) -> str | None:
    """Return a short refusal kind if ``exc`` is Postgres refusing the role, else ``None``.

    Used by the privilege tests and by the Accounting agent's VAT read, which must be able to
    tell "I am not allowed to read this" from "there was nothing to read".
    """
    sqlstate = getattr(exc, "sqlstate", None)
    if sqlstate is None:
        return None
    return REFUSAL_CODES.get(sqlstate, f"sqlstate_{sqlstate}")


@dataclass(frozen=True, slots=True)
class ClaimedRun:
    """One row returned by ``claim_agent_tasks``.

    Migration 33 returns the **run**, not the task: claiming a task starts its run in the same
    transaction, so there is never a claimed task with no run row to log against. That is why
    this carries ``run_id`` and why nothing here invents a second bookkeeping path.
    """

    run_id: str
    task_id: str | None
    agent_id: str
    customer_id: str | None
    payload: dict[str, Any]
    attempts: int


@dataclass(frozen=True, slots=True)
class AgentRegistryRow:
    """A row of ``agents`` — ``SELECT`` only for this role, deliberately no ``UPDATE``."""

    id: str
    key: str
    active: bool
    config: dict[str, Any]


class Database:
    """A thin, explicit wrapper. No ORM, no query builder — the grants are the API surface."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @contextmanager
    def connect(self) -> Iterator[psycopg.Connection[dict[str, Any]]]:
        """Open a connection with ``dict_row`` and autocommit.

        Autocommit matters for the log: ``agent_run_logs`` lines must be visible to S4's
        dashboard **as the run proceeds** (realtime), so they cannot sit in a transaction that
        commits when the run ends.
        """
        with psycopg.connect(self._dsn, autocommit=True, row_factory=dict_row) as conn:
            yield conn

    # ------------------------------------------------------------ identity
    @staticmethod
    def whoami(conn: psycopg.Connection[dict[str, Any]]) -> dict[str, Any]:
        """Who the database thinks we are. Logged at the start of every run.

        ``is_staff`` is expected to be false and ``auth_uid`` null — that is the §9.1 property
        the whole boundary rests on, so it is asserted out loud rather than assumed.
        """
        with conn.cursor() as cur:
            cur.execute("select current_user as role, session_user as login")
            row = cur.fetchone() or {}
            try:
                cur.execute("select public.is_staff('owner','operator') as is_staff")
                is_staff_row = cur.fetchone() or {}
                row["is_staff"] = is_staff_row.get("is_staff")
            except pg_errors.Error:
                # No grant on is_staff() is itself a fine answer to "are you staff".
                row["is_staff"] = None
            return row

    # ------------------------------------------------------------ registry
    @staticmethod
    def agent_by_key(conn: psycopg.Connection[dict[str, Any]], key: str) -> AgentRegistryRow | None:
        with conn.cursor() as cur:
            cur.execute(
                "select id::text, key, active, config from public.agents where key = %s",
                (key,),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return AgentRegistryRow(
            id=row["id"], key=row["key"], active=row["active"], config=row["config"] or {}
        )

    @staticmethod
    def agent_key_by_id(conn: psycopg.Connection[dict[str, Any]], agent_id: str) -> str | None:
        with conn.cursor() as cur:
            cur.execute("select key from public.agents where id = %s", (agent_id,))
            row = cur.fetchone()
        return None if row is None else str(row["key"])

    # ------------------------------------------------------------ the two granted functions
    @staticmethod
    def claim_agent_tasks(conn: psycopg.Connection[dict[str, Any]], limit: int) -> list[ClaimedRun]:
        """``claim_agent_tasks`` — granted to ``agent`` only (migration 34)."""
        with conn.cursor() as cur:
            cur.execute(
                "select run_id::text, task_id::text, agent_id::text, customer_id::text, "
                "payload, attempts from public.claim_agent_tasks(%s)",
                (limit,),
            )
            rows = cur.fetchall()
        return [
            ClaimedRun(
                run_id=r["run_id"],
                task_id=r["task_id"],
                agent_id=r["agent_id"],
                customer_id=r["customer_id"],
                payload=r["payload"] or {},
                attempts=r["attempts"],
            )
            for r in rows
        ]

    @staticmethod
    def open_unqueued_run(conn: psycopg.Connection[dict[str, Any]], agent_id: str) -> str:
        """Open a run with no task behind it — a scheduled run (``task_id`` is nullable).

        Uses the ``INSERT (task_id, agent_id, customer_id)`` column grant plus ``SELECT`` for
        ``RETURNING``, exactly the pair migration 34's comment explains.
        """
        with conn.cursor() as cur:
            cur.execute(
                "insert into public.agent_runs (task_id, agent_id, customer_id) "
                "values (null, %s, null) returning id::text",
                (agent_id,),
            )
            row = cur.fetchone()
        if row is None:  # pragma: no cover - INSERT ... RETURNING always returns a row
            raise RuntimeError("failed to open an agent run")
        return str(row["id"])

    @staticmethod
    def finish_agent_run(
        conn: psycopg.Connection[dict[str, Any]],
        *,
        run_id: str,
        ok: bool,
        conclusion: str | None = None,
        error: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        cost_usd: Decimal | None = None,
        result: str | None = None,
        final: bool = False,
    ) -> dict[str, Any] | None:
        """``finish_agent_run`` — granted to ``agent`` only; the sole way a run is closed.

        ``finished_at`` is not in this role's ``UPDATE`` column grant, so a bare ``UPDATE``
        cannot close a run and skip the task reconciliation this function performs.
        """
        with conn.cursor() as cur:
            cur.execute(
                "select (public.finish_agent_run(%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s))"
                ".finished_at as finished_at",
                (
                    run_id,
                    ok,
                    conclusion,
                    error,
                    input_tokens,
                    output_tokens,
                    cost_usd,
                    result,
                    final,
                ),
            )
            return cur.fetchone()

    # ------------------------------------------------------------ logs
    @staticmethod
    def log(conn: psycopg.Connection[dict[str, Any]], run_id: str, level: str, message: str) -> int:
        """Append one ordered line to ``agent_run_logs``; returns its ``seq``.

        Append-only: the role has ``INSERT (run_id, level, message)`` and no ``UPDATE`` or
        ``DELETE`` grant at all. ``seq`` is a ``bigserial`` so ordering is stable even when two
        lines share a millisecond, and it is returned here so the ordering is checkable rather
        than assumed.
        """
        with conn.cursor() as cur:
            cur.execute(
                "insert into public.agent_run_logs (run_id, level, message) "
                "values (%s, %s, %s) returning seq",
                (run_id, level, message[:4000]),
            )
            row = cur.fetchone()
        return 0 if row is None else int(row["seq"])

    # ------------------------------------------------------------ outputs
    @staticmethod
    def insert_output(
        conn: psycopg.Connection[dict[str, Any]],
        *,
        run_id: str,
        agent_id: str,
        kind: str,
        payload: str,
    ) -> str:
        """Insert an ``agent_outputs`` row, which always lands ``pending`` (§8.8b).

        ``status``, ``reviewer_id``, ``reviewed_at`` and ``review_note`` are **not named in
        this statement and must never be** — they are excluded from the role's ``INSERT``
        column grant, so naming one is refused at the column-privilege check before RLS is even
        evaluated. Moving ``status`` is ``review_agent_output()``, a human staff action this
        role has no ``EXECUTE`` grant on.
        """
        with conn.cursor() as cur:
            cur.execute(
                "insert into public.agent_outputs (run_id, agent_id, kind, payload) "
                "values (%s, %s, %s, %s::jsonb) returning id::text, status",
                (run_id, agent_id, kind, payload),
            )
            row = cur.fetchone()
        if row is None:  # pragma: no cover
            raise RuntimeError("failed to insert agent output")
        return str(row["id"])

    # ------------------------------------------------------------ spend
    @staticmethod
    def day_spend_usd(conn: psycopg.Connection[dict[str, Any]]) -> Decimal:
        """Total ``cost_usd`` across every run of every agent today, Berlin time (§9.3).

        Berlin rather than UTC to match how the rest of the repo defines a day
        (``report_revenue_by_day`` groups on ``created_at at time zone 'Europe/Berlin'``), so
        "today" means the same thing in the spend figure and in the reports beside it.
        """
        with conn.cursor() as cur:
            cur.execute(
                "select coalesce(sum(cost_usd), 0) as total from public.agent_runs "
                "where (started_at at time zone 'Europe/Berlin')::date "
                "    = (now() at time zone 'Europe/Berlin')::date"
            )
            row = cur.fetchone()
        return Decimal(str((row or {}).get("total", 0)))

    # ------------------------------------------------------------ generic read
    @staticmethod
    def fetch(
        conn: psycopg.Connection[dict[str, Any]], sql: str, params: Sequence[Any] = ()
    ) -> list[dict[str, Any]]:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())
