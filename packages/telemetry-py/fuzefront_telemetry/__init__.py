"""fuzefront-telemetry — OpenTelemetry tracing + structured logging for Python
FuzeFront-family microservices.

The Python peer of ``@izzywdev/fuzefront-telemetry`` (``packages/telemetry``).
Both implementations are pinned to one contract — the same ``OTEL_*`` env vars,
the same ``trace_id``/``span_id``/``reqId`` log fields, the same pino level
numbers, and the same secret-redaction list (loaded from the single family
source ``governance/observability-redaction-paths.json``) — so a trace or log
line from a Python service is readable alongside one from a Node service.
``scripts/gate_telemetry_parity.py`` fails CI if the two drift, mirroring
``gate_identifier.py --registry-parity``.

Policy: ``governance/observability-standard.md`` (P4, P19, P21, P24, P28, P39, P41).
"""

from .config import (
    OtlpProtocol,
    ResolvedTelemetryConfig,
    normalize_protocol,
    parse_otlp_headers,
    parse_sample_ratio,
    resolve_telemetry_config,
    to_http_traces_url,
)
from .contract import (
    LOG_LEVELS,
    OTEL_ENV_VARS,
    REQUEST_ID_FIELD,
    REQUEST_ID_HEADER,
    SPAN_ID_FIELD,
    TRACE_ID_FIELD,
    TRACE_LOG_FIELDS,
)
from .init import TelemetryHandle, init_telemetry
from .logging import StructuredLogger, get_logger, with_trace_context
from .middleware import (
    TelemetryASGIMiddleware,
    TelemetryWSGIMiddleware,
    instrument_flask,
    set_matched_route,
)
from .redaction import redact, redaction_paths, redaction_source

__version__ = "1.0.0"

__all__ = [
    "LOG_LEVELS",
    "OTEL_ENV_VARS",
    "REQUEST_ID_FIELD",
    "REQUEST_ID_HEADER",
    "SPAN_ID_FIELD",
    "TRACE_ID_FIELD",
    "TRACE_LOG_FIELDS",
    "OtlpProtocol",
    "ResolvedTelemetryConfig",
    "StructuredLogger",
    "TelemetryASGIMiddleware",
    "TelemetryHandle",
    "TelemetryWSGIMiddleware",
    "get_logger",
    "init_telemetry",
    "instrument_flask",
    "normalize_protocol",
    "parse_otlp_headers",
    "parse_sample_ratio",
    "redact",
    "redaction_paths",
    "redaction_source",
    "resolve_telemetry_config",
    "set_matched_route",
    "to_http_traces_url",
    "with_trace_context",
]
