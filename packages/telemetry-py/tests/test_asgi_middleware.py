"""ASGI tracing middleware, driven against a bare ASGI app (no Starlette needed).

Mirrors identity-py's pure-ASGI test style and the Node middleware.test.ts
assertions: route-template span naming, status/elapsed attributes, inbound
traceparent continuation, and x-request-id propagation.
"""

import asyncio
import io

from conftest import build_provider
from opentelemetry.sdk.trace.sampling import ALWAYS_ON, ParentBased
from opentelemetry.trace import SpanKind

from fuzefront_telemetry import StructuredLogger, TelemetryASGIMiddleware


def _quiet_logger():
    return StructuredLogger(stream=io.StringIO())


class _Route:
    def __init__(self, path):
        self.path = path


def make_app(*, route_path=None, status=200):
    async def app(scope, receive, send):
        await receive()
        if route_path is not None:
            scope["route"] = _Route(route_path)
        body = b'{"ok":true}'
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body, "more_body": False})

    return app


def drive(mw, *, method="GET", path="/users/42", headers=None):
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": [(k.encode(), v.encode()) for k, v in (headers or {}).items()],
        "state": {},
    }
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(mw(scope, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    return scope, start


def _provider():
    return build_provider(ParentBased(root=ALWAYS_ON))


def test_server_span_uses_route_template_not_raw_path():
    provider, exporter = _provider()
    try:
        mw = TelemetryASGIMiddleware(
            make_app(route_path="/users/{id}"),
            tracer_provider=provider,
            logger=_quiet_logger(),
        )
        drive(mw, path="/users/42")
        (span,) = exporter.get_finished_spans()
        assert span.name == "GET /users/{id}"
        assert span.kind == SpanKind.SERVER
        assert span.attributes["http.route"] == "/users/{id}"
        assert span.attributes["http.method"] == "GET"
        assert span.attributes["http.status_code"] == 200
    finally:
        provider.shutdown()


def test_unmatched_request_gets_bounded_name_no_raw_path():
    provider, exporter = _provider()
    try:
        mw = TelemetryASGIMiddleware(
            make_app(route_path=None, status=404),
            tracer_provider=provider,
            logger=_quiet_logger(),
        )
        drive(mw, path="/secret-scan-path/42")
        (span,) = exporter.get_finished_spans()
        assert span.name == "GET (unmatched)"
        assert "http.route" not in span.attributes
        assert "/secret-scan-path" not in span.name
    finally:
        provider.shutdown()


def test_status_5xx_flags_error():
    provider, exporter = _provider()
    try:
        mw = TelemetryASGIMiddleware(
            make_app(route_path="/boom", status=503),
            tracer_provider=provider,
            logger=_quiet_logger(),
        )
        drive(mw)
        (span,) = exporter.get_finished_spans()
        assert span.attributes["http.status_code"] == 503
        assert span.attributes["error"] is True
    finally:
        provider.shutdown()


def test_request_id_propagated_on_response():
    provider, _exporter = _provider()
    try:
        mw = TelemetryASGIMiddleware(
            make_app(route_path="/x"),
            tracer_provider=provider,
            logger=_quiet_logger(),
        )
        _, start = drive(mw, headers={"x-request-id": "inbound-abc"})
        hdrs = {k.decode(): v.decode() for k, v in start["headers"]}
        assert hdrs["x-request-id"] == "inbound-abc"
    finally:
        provider.shutdown()


def test_inbound_traceparent_continues_trace():
    provider, exporter = _provider()
    try:
        mw = TelemetryASGIMiddleware(
            make_app(route_path="/x"),
            tracer_provider=provider,
            logger=_quiet_logger(),
        )
        tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
        scope, _ = drive(mw, headers={"traceparent": tp})
        (span,) = exporter.get_finished_spans()
        assert format(span.context.trace_id, "032x") == "4bf92f3577b34da6a3ce929d0e0e4736"
        assert format(span.parent.span_id, "016x") == "00f067aa0ba902b7"
        # ids stashed for the logger
        assert scope["state"]["trace_id"] == "4bf92f3577b34da6a3ce929d0e0e4736"
    finally:
        provider.shutdown()
