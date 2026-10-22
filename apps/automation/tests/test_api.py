"""FastAPI: health only (boot task 7)."""

from __future__ import annotations

from shosho_automation.api import app


def test_health_is_the_only_route() -> None:
    """An ingress that exists "ready for C7" is an unauthenticated ingress with no auth story."""
    paths = {route.path for route in app.routes if hasattr(route, "path")}
    # Starlette always registers these internals; no application route beyond /health.
    assert paths - {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"} == {"/health"}


def test_no_openapi_or_docs_surface() -> None:
    assert app.openapi_url is None
    assert app.docs_url is None
    assert app.redoc_url is None


def test_health_touches_no_database() -> None:
    """A health probe must not be a liveness oracle for the database."""
    import inspect

    from shosho_automation import api

    source = inspect.getsource(api)
    assert "psycopg" not in source
    assert "Database" not in source
    assert "AUTOMATION_DATABASE_URL" not in source


def test_health_payload() -> None:
    from shosho_automation.api import health

    body = health()
    assert body["status"] == "ok"
    assert body["service"] == "automation"
