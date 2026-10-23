"""Run mypy as part of the test suite.

Why this is a test rather than a CI step: the boot asks for CI to run **lint, types and
tests**, but `.github/workflows/ci.yml`'s `python (automation)` job runs only ruff and pytest —
and `.github/workflows/**` is S1's (D-004), so editing it is out of boundary. Putting the type
check inside pytest makes the existing job actually enforce types without touching S1's file.

Reported in log.md as the cleaner fix: a `mypy .` step in that job, after which this file can
go away.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(
    importlib.util.find_spec("mypy") is None,
    reason="mypy not installed in this environment",
)
def test_mypy_is_clean() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "mypy", "--config-file", str(PROJECT_ROOT / "pyproject.toml")],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"mypy reported problems:\n{result.stdout}\n{result.stderr}"
