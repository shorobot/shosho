"""Placeholder FastAPI service. Replaced by apps/automation API in backend-01+.

Exposes only /health so the compose stack and the reverse proxy have a target.
"""

from fastapi import FastAPI

app = FastAPI(title="shosho-api-placeholder")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "shosho-api-placeholder"}
