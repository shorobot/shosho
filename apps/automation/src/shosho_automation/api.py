"""FastAPI: a health endpoint and nothing else (boot task 7).

D-020 has FastAPI fronting Lieferando and Wolt, but that is **step C7** and blocked on the
owner's platform access (plan.md D2). So this app has exactly one route, it takes no input, and
it reaches no database.

The reason that is a deliberate choice rather than laziness: an unauthenticated ingress is how
TETA+PI's ``mcp.tetapi.dev`` hole happened. An ingress that exists "ready for C7" is an
unauthenticated ingress with no authentication story yet, so none is opened here. When C7
arrives it brings its own authentication for its own routes.

Health deliberately reports **no** database state. A health probe that connects to Postgres
with the ``agent`` credential turns an unauthenticated route into a liveness oracle for the
database, and a container healthcheck does not need one.
"""

from __future__ import annotations

from typing import Final

from fastapi import FastAPI

from . import __version__

app: Final = FastAPI(
    title="SHOSHO automation",
    version=__version__,
    description="Agent orchestrator health surface. No external routes (C7 is not in scope).",
    docs_url=None,  # no interactive docs on an unauthenticated surface
    redoc_url=None,
    openapi_url=None,
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness only: the process is up. No database, no secret, no input."""
    return {"status": "ok", "service": "automation", "version": __version__}
