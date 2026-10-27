"""WSGI tracing middleware + the Flask integration."""

import io

from conftest import build_provider
from opentelemetry.sdk.trace.sampling import ALWAYS_ON, ParentBased
from opentelemetry.trace import SpanKind

from fuzefront_telemetry import (
    StructuredLogger,
    TelemetryWSGIMiddleware,
    instrument_flask,
    set_matched_route,
)


def _devnull_logger():
    return StructuredLogger(stream=io.StringIO())


def make_wsgi_app(*, route=None, status="200 OK"):
    def app(environ, start_response):
        if route is not None:
            set_matched_route(environ, route)
        start_response(status, [("Content-Type", "text/plain")])
        return [b"ok"]

    return app


def drive_wsgi(mw, *, headers=None):
    environ = {"REQUEST_METHOD": "GET", "PATH_INFO": "/users/42"}
    for k, v in (headers or {}).items():
        environ[f"HTTP_{k.upper().replace('-', '_')}"] = v
    captured = {}

    def start_response(status, response_headers, exc_info=None):
        captured["status"] = status
        captured["headers"] = response_headers

    result = mw(environ, start_response)
    list(result)  # consume -> StopIteration -> finalize span
    if hasattr(result, "close"):
        result.close()
    return environ, captured


def test_wsgi_span_uses_matched_route_template():
    provider, exporter = build_provider(ParentBased(root=ALWAYS_ON))
    try:
        mw = TelemetryWSGIMiddleware(
            make_wsgi_app(route="/users/<id>"),
            tracer_provider=provider,
            logger=_devnull_logger(),
        )
        drive_wsgi(mw)
        (span,) = exporter.get_finished_spans()
        assert span.name == "GET /users/<id>"
        assert span.kind == SpanKind.SERVER
        assert span.attributes["http.route"] == "/users/<id>"
        assert span.attributes["http.status_code"] == 200
    finally:
        provider.shutdown()


def test_wsgi_route_resolver_fallback():
    provider, exporter = build_provider(ParentBased(root=ALWAYS_ON))
    try:
        mw = TelemetryWSGIMiddleware(
            make_wsgi_app(route=None),
            tracer_provider=provider,
            logger=_devnull_logger(),
            route_resolver=lambda env: "/resolved/<x>",
        )
        drive_wsgi(mw)
        (span,) = exporter.get_finished_spans()
        assert span.name == "GET /resolved/<x>"
    finally:
        provider.shutdown()


def test_wsgi_unmatched_bounded_name():
    provider, exporter = build_provider(ParentBased(root=ALWAYS_ON))
    try:
        mw = TelemetryWSGIMiddleware(
            make_wsgi_app(route=None, status="404 NOT FOUND"),
            tracer_provider=provider,
            logger=_devnull_logger(),
        )
        drive_wsgi(mw)
        (span,) = exporter.get_finished_spans()
        assert span.name == "GET (unmatched)"
        assert "http.route" not in span.attributes
    finally:
        provider.shutdown()


def test_wsgi_request_id_propagated():
    provider, _exporter = build_provider(ParentBased(root=ALWAYS_ON))
    try:
        mw = TelemetryWSGIMiddleware(
            make_wsgi_app(route="/x"),
            tracer_provider=provider,
            logger=_devnull_logger(),
        )
        _, captured = drive_wsgi(mw, headers={"x-request-id": "r-xyz"})
        hdrs = dict(captured["headers"])
        assert hdrs["x-request-id"] == "r-xyz"
    finally:
        provider.shutdown()


def test_flask_integration_reads_url_rule():
    flask = __import__("flask")
    provider, exporter = build_provider(ParentBased(root=ALWAYS_ON))
    try:
        app = flask.Flask(__name__)

        @app.route("/users/<user_id>")
        def show(user_id):
            return {"id": user_id}

        instrument_flask(app, tracer_provider=provider, logger=_devnull_logger())
        client = app.test_client()
        resp = client.get("/users/42", headers={"x-request-id": "flask-req"})
        assert resp.status_code == 200
        assert resp.headers["x-request-id"] == "flask-req"
        # The WSGI server ends the response by close()-ing the iterable; the
        # test client defers that, so close it explicitly to end the span.
        resp.close()
        (span,) = exporter.get_finished_spans()
        assert span.name == "GET /users/<user_id>"
        assert span.attributes["http.route"] == "/users/<user_id>"
    finally:
        provider.shutdown()
