"""Command-line entry points.

``run-once``   claim whatever is queued, run it, close it, print what happened.
``schedule``   open a run with no queued task (``task_id`` null) and execute one agent.
``whoami``     print what the database thinks this connection is — the §9.1 property.

No command sleeps or loops forever: scheduling is C5's (a container and a cron), and a
long-lived poller is not this boot's scope.
"""

from __future__ import annotations

import argparse
import json
import sys

from .config import ConfigError, Settings
from .db import Database
from .orchestrator import Orchestrator


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="shosho-automation")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("run-once", help="claim and run whatever is queued, then exit")
    sub.add_parser("whoami", help="print the database identity of this connection")

    sched = sub.add_parser("schedule", help="run one agent without a queued task")
    sched.add_argument("agent", help="agents.key, e.g. 'accounting'")
    sched.add_argument(
        "--payload", default="{}", help="JSON task payload, e.g. '{\"period_start\": ...}'"
    )

    args = parser.parse_args(argv)
    try:
        settings = Settings.from_env()
    except ConfigError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2

    if args.command == "whoami":
        db = Database(settings.database_url)
        with db.connect() as conn:
            print(json.dumps(Database.whoami(conn), default=str))
        return 0

    orch = Orchestrator(settings)
    if args.command == "run-once":
        report = orch.run_once()
        print(
            json.dumps(
                {
                    "claimed": report.claimed,
                    "succeeded": report.succeeded,
                    "failed": report.failed,
                    "refused": report.skipped,
                    "day_cost_usd": report.cost_usd,
                    "notes": report.notes,
                },
                indent=2,
            )
        )
        return 0 if report.failed == 0 else 1

    if args.command == "schedule":
        try:
            payload = json.loads(args.payload)
        except json.JSONDecodeError as exc:
            print(f"--payload is not valid JSON: {exc}", file=sys.stderr)
            return 2
        run_id = orch.run_scheduled(args.agent, payload)
        print(json.dumps({"run_id": run_id}))
        return 0

    return 2  # pragma: no cover - argparse requires a known subcommand


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
