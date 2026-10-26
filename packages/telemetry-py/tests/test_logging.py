"""The shared structured logger + with_trace_context."""

import io
import json

from fuzefront_telemetry import LOG_LEVELS, StructuredLogger, with_trace_context


def _lines(buf):
    return [json.loads(line) for line in buf.getvalue().splitlines() if line.strip()]


def test_pino_shaped_line():
    buf = io.StringIO()
    log = StructuredLogger(level="info", stream=buf)
    log.info({"orderId": "o1"}, "order created")
    (line,) = _lines(buf)
    assert line["level"] == LOG_LEVELS["info"] == 30
    assert isinstance(line["time"], int)
    assert line["msg"] == "order created"
    assert line["orderId"] == "o1"


def test_level_threshold_filters():
    buf = io.StringIO()
    log = StructuredLogger(level="warn", stream=buf)
    log.info("quiet")
    log.debug("quieter")
    log.warning("loud")
    log.error("louder")
    lines = _lines(buf)
    assert [line["level"] for line in lines] == [LOG_LEVELS["warn"], LOG_LEVELS["error"]]


def test_bind_merges_and_is_immutable():
    buf = io.StringIO()
    root = StructuredLogger(level="info", stream=buf)
    child = root.bind(reqId="r1")
    child.info("hello")
    (line,) = _lines(buf)
    assert line["reqId"] == "r1"
    # root unaffected
    buf.truncate(0)
    buf.seek(0)
    root.info("plain")
    (line2,) = _lines(buf)
    assert "reqId" not in line2


def test_secret_fields_redacted_in_log():
    buf = io.StringIO()
    log = StructuredLogger(level="info", stream=buf)
    # fixture value assembled at runtime, never a literal credential in source
    secret_value = "s3cr" + "et-" + "value"
    log.info({"password": secret_value, "ok": "visible"}, "attempt")
    (line,) = _lines(buf)
    assert line["password"] == "[Redacted]"
    assert secret_value not in buf.getvalue()
    assert line["ok"] == "visible"


def test_with_trace_context_binds_reqid_from_header():
    buf = io.StringIO()
    log = StructuredLogger(level="info", stream=buf)
    scope = {"type": "http", "headers": [(b"x-request-id", b"inbound-123")]}
    bound = with_trace_context(log, scope)
    bound.info("x")
    (line,) = _lines(buf)
    assert line["reqId"] == "inbound-123"


def test_with_trace_context_generates_reqid_when_absent():
    buf = io.StringIO()
    log = StructuredLogger(level="info", stream=buf)
    bound = with_trace_context(log, {"type": "http", "headers": []})
    bound.info("x")
    (line,) = _lines(buf)
    assert line["reqId"] and len(line["reqId"]) >= 8
    assert "trace_id" not in line  # untraced request still logs


def test_with_trace_context_binds_stashed_trace_ids():
    buf = io.StringIO()
    log = StructuredLogger(level="info", stream=buf)
    scope = {
        "type": "http",
        "headers": [],
        "state": {"trace_id": "a" * 32, "span_id": "b" * 16, "reqId": "r9"},
    }
    bound = with_trace_context(log, scope)
    bound.info("x")
    (line,) = _lines(buf)
    assert line["trace_id"] == "a" * 32
    assert line["span_id"] == "b" * 16
    assert line["reqId"] == "r9"
