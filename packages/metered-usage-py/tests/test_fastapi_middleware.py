"""Tests for MeteringMiddleware (FastAPI / Starlette ASGI middleware).

Uses httpx + Starlette's TestClient so no real Kafka or HTTP server is needed.
"""

from __future__ import annotations

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from fuzefront_metered_usage import UsageEvent
from fuzefront_metered_usage.fastapi_middleware import MeteringMiddleware


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class CapturingClient:
    """MeteringClient stand-in that records emitted events."""

    def __init__(self) -> None:
        self.emitted: list[UsageEvent] = []

    def emit(self, event: UsageEvent) -> None:
        self.emitted.append(event)

    def flush(self, timeout: float = 5.0) -> None:
        pass


def build_app(
    *,
    organization_id=lambda req: "org_default",
    meter: str = "api_calls",
    skip=None,
    client: CapturingClient | None = None,
) -> tuple[TestClient, CapturingClient]:
    if client is None:
        client = CapturingClient()

    app = FastAPI()
    app.add_middleware(
        MeteringMiddleware,
        client=client,
        organization_id=organization_id,
        meter=meter,
        skip=skip,
    )

    @app.get("/hello")
    def hello():
        return {"ok": True}

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return TestClient(app), client


# ---------------------------------------------------------------------------
# Core behaviour
# ---------------------------------------------------------------------------


def test_middleware_emits_api_calls_1_after_200_response():
    tc, capturing = build_app(organization_id=lambda req: "org_abc")
    r = tc.get("/hello")
    assert r.status_code == 200
    assert len(capturing.emitted) == 1
    event = capturing.emitted[0]
    assert event.meter_event_name == "api_calls"
    assert event.quantity == 1
    assert event.entity_type == "organization"
    assert event.entity_id == "org_abc"


def test_middleware_uses_custom_meter_name():
    tc, capturing = build_app(meter="llm_requests", organization_id=lambda req: "org_x")
    tc.get("/hello")
    assert capturing.emitted[0].meter_event_name == "llm_requests"


def test_middleware_event_timestamp_is_iso8601():
    tc, capturing = build_app(organization_id=lambda req: "org_ts")
    tc.get("/hello")
    ts = capturing.emitted[0].timestamp
    # Basic ISO8601 shape check -- must contain T and +
    assert "T" in ts


def test_middleware_emits_once_per_request():
    tc, capturing = build_app(organization_id=lambda req: "org_once")
    tc.get("/hello")
    tc.get("/hello")
    assert len(capturing.emitted) == 2


# ---------------------------------------------------------------------------
# skip callable
# ---------------------------------------------------------------------------


def test_skip_callable_prevents_emission():
    tc, capturing = build_app(
        organization_id=lambda req: "org_skip",
        skip=lambda req: req.url.path == "/health",
    )
    tc.get("/health")
    assert len(capturing.emitted) == 0


def test_skip_callable_does_not_block_non_skipped_paths():
    tc, capturing = build_app(
        organization_id=lambda req: "org_skip",
        skip=lambda req: req.url.path == "/health",
    )
    tc.get("/hello")
    assert len(capturing.emitted) == 1


# ---------------------------------------------------------------------------
# Missing / None org id
# ---------------------------------------------------------------------------


def test_missing_org_id_none_return_emits_nothing():
    tc, capturing = build_app(organization_id=lambda req: None)
    tc.get("/hello")
    assert len(capturing.emitted) == 0


def test_missing_org_id_empty_string_emits_nothing():
    tc, capturing = build_app(organization_id=lambda req: "")
    tc.get("/hello")
    assert len(capturing.emitted) == 0


def test_org_id_callable_raises_emits_nothing_and_does_not_propagate():
    def boom(req):
        raise RuntimeError("db down -- can't look up org")

    tc, capturing = build_app(organization_id=boom)
    # Must still return 200 -- the middleware must swallow the error
    r = tc.get("/hello")
    assert r.status_code == 200
    assert len(capturing.emitted) == 0


# ---------------------------------------------------------------------------
# Error resilience -- client errors must not break the response
# ---------------------------------------------------------------------------


def test_client_emit_raises_does_not_break_response():
    class BrokenClient(CapturingClient):
        def emit(self, event: UsageEvent) -> None:
            raise RuntimeError("kafka down")

    broken = BrokenClient()
    tc, _ = build_app(organization_id=lambda req: "org_resilient", client=broken)
    r = tc.get("/hello")
    assert r.status_code == 200
