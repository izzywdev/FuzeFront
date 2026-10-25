"""fuzefront-telemetry — the shared structured-JSON logger + ``with_trace_context``.

The Python peer of the family pino logger and ``withTraceContext``
(``packages/telemetry/src/logging.ts``). Emits one JSON object per line to
stdout with the SAME shape a pino line has, so a Loki query spanning Node and
Python services sorts and filters by one ``level`` scale and joins on the same
correlation fields::

    {"level":30,"time":1735000000000,"msg":"request completed",
     "reqId":"a1b2c3d4","trace_id":"4bf92f...4736","span_id":"00f067...02b7"}

- ``level`` is pino's numeric level (``info`` -> 30), from ``contract.LOG_LEVELS``.
- ``time`` is epoch milliseconds, like pino's default timestamp.
- Verbosity is controlled by ``LOG_LEVEL`` read at construction; prod default
  ``info``.
- Every field bound or logged passes through the shared secret-redaction list.
"""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Mapping
from typing import Any, TextIO

from opentelemetry import trace

from .contract import (
    LOG_LEVEL_ENV,
    LOG_LEVELS,
    REQUEST_ID_FIELD,
    REQUEST_ID_HEADER,
    SPAN_ID_FIELD,
    TRACE_ID_FIELD,
)
from .redaction import redact

_DEFAULT_LEVEL = "info"


def _threshold(level_name: str | None) -> int:
    name = (level_name or os.environ.get(LOG_LEVEL_ENV) or _DEFAULT_LEVEL).strip().lower()
    return LOG_LEVELS.get(name, LOG_LEVELS[_DEFAULT_LEVEL])


class StructuredLogger:
    """A pino-shaped structured JSON logger with child bindings.

    ``bind(**fields)`` returns a new logger carrying those fields on every line
    (pino's ``logger.child(bindings)``). The log methods — ``trace``, ``debug``,
    ``info``, ``warn``, ``error``, ``fatal`` — take ``(msg)`` or ``(fields,
    msg)``, matching pino's ``logger.info(obj, msg)`` call shape.
    """

    def __init__(
        self,
        *,
        level: str | None = None,
        bindings: Mapping[str, Any] | None = None,
        stream: TextIO | None = None,
    ) -> None:
        self._level_name = (level or os.environ.get(LOG_LEVEL_ENV) or _DEFAULT_LEVEL).strip().lower()
        self._threshold = _threshold(self._level_name)
        self._bindings: dict[str, Any] = dict(bindings or {})
        self._stream = stream if stream is not None else sys.stdout

    def bind(self, **fields: Any) -> StructuredLogger:
        merged = {**self._bindings, **fields}
        return StructuredLogger(level=self._level_name, bindings=merged, stream=self._stream)

    # pino uses `child`; expose both so call sites can read either way.
    child = bind

    def _emit(self, level_name: str, arg1: Any, arg2: str | None) -> None:
        if LOG_LEVELS[level_name] < self._threshold:
            return
        if isinstance(arg1, Mapping):
            fields: dict[str, Any] = dict(arg1)
            msg = arg2
        else:
            fields = {}
            msg = arg1
        line: dict[str, Any] = {
            "level": LOG_LEVELS[level_name],
            "time": int(time.time() * 1000),
            **self._bindings,
            **fields,
        }
        if msg is not None:
            line["msg"] = msg
        import json

        self._stream.write(json.dumps(redact(line), default=str, separators=(",", ":")) + "\n")
        self._stream.flush()

    def trace(self, arg1: Any = None, arg2: str | None = None) -> None:
        self._emit("trace", arg1, arg2)

    def debug(self, arg1: Any = None, arg2: str | None = None) -> None:
        self._emit("debug", arg1, arg2)

    def info(self, arg1: Any = None, arg2: str | None = None) -> None:
        self._emit("info", arg1, arg2)

    def warning(self, arg1: Any = None, arg2: str | None = None) -> None:
        self._emit("warn", arg1, arg2)

    # pino names this level `warn`; expose it as an alias so Node-shaped call
    # sites read the same, while `warning` is the Python-conventional primary.
    warn = warning

    def error(self, arg1: Any = None, arg2: str | None = None) -> None:
        self._emit("error", arg1, arg2)

    def fatal(self, arg1: Any = None, arg2: str | None = None) -> None:
        self._emit("fatal", arg1, arg2)


_ROOT: StructuredLogger | None = None


def get_logger(**bindings: Any) -> StructuredLogger:
    """The ONE shared root logger (optionally with initial bindings), analogous
    to the family's single ``logger`` instance. ``LOG_LEVEL`` is read once here.
    """
    global _ROOT
    if _ROOT is None:
        _ROOT = StructuredLogger()
    return _ROOT.bind(**bindings) if bindings else _ROOT


def _header(request: Any, name: str) -> str | None:
    """Best-effort case-insensitive header read across the shapes a request can
    take: an ASGI ``scope`` dict, a Starlette/Flask request (``.headers``), or a
    plain mapping of headers.
    """
    lname = name.lower()
    headers = getattr(request, "headers", None)
    if headers is None and isinstance(request, Mapping):
        if "headers" in request:
            raw = request["headers"]
            # ASGI scope headers: list of (bytes, bytes)
            if isinstance(raw, (list, tuple)):
                for k, v in raw:
                    key = k.decode("latin1") if isinstance(k, bytes) else str(k)
                    if key.lower() == lname:
                        return v.decode("latin1") if isinstance(v, bytes) else str(v)
                return None
            headers = raw
        else:
            headers = request
    if headers is None:
        return None
    # Mapping-like (Starlette Headers, Flask headers, dict) — all support .get
    try:
        getter = headers.get
    except AttributeError:
        return None
    val = getter(name)
    if val is None:
        val = getter(lname)
    return str(val) if val is not None else None


def _trace_context_from(request: Any) -> tuple[str | None, str | None]:
    """Resolve ``(trace_id, span_id)`` for a request: prefer ids the middleware
    stashed on the request/scope, else the currently-active span.
    """
    # Middleware stashes onto scope["state"] (ASGI) or request.state (Starlette).
    stash: Any = None
    if isinstance(request, Mapping):
        stash = request.get("state")
    else:
        stash = getattr(request, "state", None)
    if stash is not None:
        tid = stash.get(TRACE_ID_FIELD) if isinstance(stash, Mapping) else getattr(stash, TRACE_ID_FIELD, None)
        sid = stash.get(SPAN_ID_FIELD) if isinstance(stash, Mapping) else getattr(stash, SPAN_ID_FIELD, None)
        if tid:
            return tid, sid

    span = trace.get_current_span()
    ctx = span.get_span_context()
    if ctx is not None and ctx.is_valid:
        return format(ctx.trace_id, "032x"), format(ctx.span_id, "016x")
    return None, None


def with_trace_context(
    logger: StructuredLogger,
    request: Any = None,
    *,
    request_id: str | None = None,
) -> StructuredLogger:
    """Bind ``trace_id``/``span_id`` (+ ``reqId``) onto ``logger`` for Tempo/Loki
    correlation, mirroring the Node ``withTraceContext``.

    - ``trace_id``/``span_id`` come from the active span or from what the
      tracing middleware stashed on the request. If neither is available (an
      untraced request), the ORIGINAL logger is returned with just ``reqId`` —
      it never throws or drops existing bindings.
    - ``reqId`` is taken from ``request_id`` if given, else the inbound
      ``x-request-id`` header, else a freshly generated UUID. It is the
      FuzeFront-local id, propagated downstream as ``x-request-id`` by the
      middleware.
    """
    req_id = request_id
    if req_id is None and request is not None:
        req_id = _header(request, REQUEST_ID_HEADER)
    if req_id is None and request is not None:
        # A reqId the tracing middleware already stashed (so a standalone
        # with_trace_context call stays consistent with the middleware's choice).
        stash = request.get("state") if isinstance(request, Mapping) else getattr(request, "state", None)
        if isinstance(stash, Mapping):
            req_id = stash.get(REQUEST_ID_FIELD)
        elif stash is not None:
            req_id = getattr(stash, REQUEST_ID_FIELD, None)
    if req_id is None:
        import uuid

        req_id = uuid.uuid4().hex

    bindings: dict[str, Any] = {REQUEST_ID_FIELD: req_id}

    if request is not None:
        trace_id, span_id = _trace_context_from(request)
        if trace_id:
            bindings[TRACE_ID_FIELD] = trace_id
            if span_id:
                bindings[SPAN_ID_FIELD] = span_id

    return logger.bind(**bindings)


__all__ = ["StructuredLogger", "get_logger", "with_trace_context"]
