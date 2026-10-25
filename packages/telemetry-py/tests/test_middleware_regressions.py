"""Regression tests for the Codex findings on PR #1663.

Each asserts the observable behaviour the finding was about, so the fix is
pinned and a reintroduction fails CI.
"""

import asyncio
import io
import json

import pytest
from conftest import build_provider
from opentelemetry.sdk.trace.sampling import ALWAYS_ON, ParentBased

from fuzefront_telemetry import (
    StructuredLogger,
    TelemetryASGIMiddleware,
    TelemetryWSGIMiddleware,
    redact,
    with_trace_context,
)


def _provider():
    return build_provider(ParentBased(root=ALWAYS_ON))


# --- Finding 1: plain Starlette (no FastAPI) still yields the route template ---

def test_asgi_plain_starlette_route_template_not_unmatched():
    pytest.importorskip("starlette")
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route
    from starlette.testclient import TestClient

    provider, exporter = _provider()
    try:
        async def user(request):
            return PlainTextResponse("ok")

        app = Starlette(routes=[Route("/users/{id}", user)])
        app = TelemetryASGIMiddleware(
            app, tracer_provider=provider, logger=StructuredLogger(stream=io.StringIO())
        )
        TestClient(app).get("/users/42")
        (span,) = exporter.get_finished_spans()
        # The matched TEMPLATE, never the raw /users/42 — bounded cardinality (P14).
        assert span.name == "GET /users/{id}"
        assert span.attributes["http.route"] == "/users/{id}"
        assert "/users/42" not in span.name
    finally:
        provider.shutdown()


# --- Finding 2: WSGI entry/exit logs carry this request's trace_id/span_id ---

def test_wsgi_logs_carry_trace_and_span_id():
    provider, exporter = _provider()
    try:
        buf = io.StringIO()
        logger = StructuredLogger(level="debug", stream=buf)

        def app(environ, start_response):
            start_response("200 OK", [("Content-Type", "text/plain")])
            return [b"ok"]

        mw = TelemetryWSGIMiddleware(app, tracer_provider=provider, logger=logger)
        result = mw({"REQUEST_METHOD": "GET", "PATH_INFO": "/x"}, lambda *a, **k: None)
        list(result)

        (span,) = exporter.get_finished_spans()
        trace_id = format(span.context.trace_id, "032x")
        span_id = format(span.context.span_id, "016x")
        lines = [json.loads(line) for line in buf.getvalue().splitlines() if line.strip()]
        assert len(lines) == 2  # entry + exit
        for line in lines:
            assert line["trace_id"] == trace_id
            assert line["span_id"] == span_id
    finally:
        provider.shutdown()


# --- Finding 3: ASGI cancellation ends + exports the span (CancelledError is BaseException) ---

def test_asgi_cancellation_still_ends_span_and_propagates():
    provider, exporter = _provider()
    try:
        async def app(scope, receive, send):
            raise asyncio.CancelledError()

        mw = TelemetryASGIMiddleware(
            app, tracer_provider=provider, logger=StructuredLogger(stream=io.StringIO())
        )
        scope = {"type": "http", "method": "GET", "headers": [], "path": "/c", "state": {}}

        async def receive():
            return {"type": "http.request"}

        async def send(message):
            pass

        with pytest.raises(asyncio.CancelledError):
            asyncio.run(mw(scope, receive, send))

        # Before the fix: `except Exception` missed CancelledError, so the span
        # was never ended/exported. The `finally` guarantees it now.
        (span,) = exporter.get_finished_spans()
        assert span.attributes["error"] is True
    finally:
        provider.shutdown()


# --- Finding 4: WSGI body raising after a 2xx status line flags the span errored ---

def test_wsgi_streaming_error_after_200_flags_span():
    provider, exporter = _provider()
    try:
        def app(environ, start_response):
            start_response("200 OK", [("Content-Type", "text/plain")])

            def gen():
                yield b"part1"
                raise RuntimeError("boom mid-stream")

            return gen()

        mw = TelemetryWSGIMiddleware(
            app, tracer_provider=provider, logger=StructuredLogger(stream=io.StringIO())
        )
        result = mw({"REQUEST_METHOD": "GET", "PATH_INFO": "/s"}, lambda *a, **k: None)
        with pytest.raises(RuntimeError):
            list(result)

        (span,) = exporter.get_finished_spans()
        # Status line was 200, but the body failed — error must still be recorded
        # so trace-based error queries surface it.
        assert span.attributes["http.status_code"] == 200
        assert span.attributes["error"] is True
    finally:
        provider.shutdown()


# --- Finding 5 (P1): redaction walks non-dict Mappings (Starlette Headers) ---

def test_redaction_walks_starlette_headers_mapping():
    pytest.importorskip("starlette")
    from starlette.datastructures import Headers

    headers = Headers(
        {
            "authorization": "Bearer SECRET_TOKEN_123",
            "cookie": "session=SECRETCOOKIE",
            "x-ok": "fine",
        }
    )
    payload = {"req": {"headers": headers}}

    # Direct redaction path.
    rendered = json.dumps(redact(payload), default=str)
    assert "SECRET_TOKEN_123" not in rendered
    assert "SECRETCOOKIE" not in rendered
    assert "fine" in rendered  # non-secret key survives

    # The single shared path the logger uses (StructuredLogger._emit -> redact).
    buf = io.StringIO()
    StructuredLogger(level="info", stream=buf).info(payload, "req")
    emitted = buf.getvalue()
    assert "SECRET_TOKEN_123" not in emitted
    assert "SECRETCOOKIE" not in emitted


# --- Finding 6 (P2): parameterized mount -> template route, never the resolved value ---

def test_asgi_parameterized_mount_route_is_template_not_resolved():
    pytest.importorskip("starlette")
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Mount, Route
    from starlette.testclient import TestClient

    provider, exporter = _provider()
    try:
        async def user(request):
            return PlainTextResponse("ok")

        sub = Starlette(routes=[Route("/users/{id}", user)])
        app = Starlette(routes=[Mount("/tenants/{tenant}", app=sub)])
        app = TelemetryASGIMiddleware(
            app, tracer_provider=provider, logger=StructuredLogger(stream=io.StringIO())
        )
        TestClient(app).get("/tenants/alpha/users/42")
        (span,) = exporter.get_finished_spans()
        # Template only — the resolved tenant ("alpha") must never reach the span.
        assert span.attributes["http.route"] == "/users/{id}"
        assert "alpha" not in span.name
        assert "alpha" not in span.attributes["http.route"]
    finally:
        provider.shutdown()


# --- Finding 7 (P3): request-free with_trace_context binds the active span ---

def test_with_trace_context_without_request_binds_active_span():
    provider, _exporter = _provider()
    try:
        tracer = provider.get_tracer("t")
        buf = io.StringIO()
        logger = StructuredLogger(stream=buf)
        with tracer.start_as_current_span("op") as span:
            log = with_trace_context(logger)  # no request argument
            log.info("inside span")
            trace_id = format(span.get_span_context().trace_id, "032x")
            span_id = format(span.get_span_context().span_id, "016x")
        line = json.loads(buf.getvalue().splitlines()[0])
        assert line["trace_id"] == trace_id
        assert line["span_id"] == span_id
    finally:
        provider.shutdown()
