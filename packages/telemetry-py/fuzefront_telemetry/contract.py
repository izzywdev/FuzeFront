"""fuzefront-telemetry — the cross-language telemetry contract.

These constants are the Python half of the contract pinned in parity to the
Node package ``@izzywdev/fuzefront-telemetry`` (``packages/telemetry``). A
trace emitted by a Python service must be readable alongside one from a Node
service, and a log line from either must carry the same correlation fields —
so the env vars read, the log field keys bound, and the level names/values are
identical on both sides.

``scripts/gate_telemetry_parity.py`` extracts the Node-side values straight
from the Node package source and fails CI if any of these drift from it
(mirroring ``gate_identifier.py --registry-parity``). Do not edit a value here
without making the matching change on the Node side in the same PR.
"""

from __future__ import annotations

from types import MappingProxyType

# --- OTLP export env vars -------------------------------------------------
#
# The standard ``OTEL_*`` env vars ``init_telemetry`` reads, matching
# ``packages/telemetry/src/config.ts`` exactly. Production/k8s sets these via
# Helm; local dev falls back to the docker-compose collector default.
OTEL_ENV_VARS: tuple[str, ...] = (
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "OTEL_TRACES_SAMPLER_ARG",
    "OTEL_EXPORTER_OTLP_HEADERS",
)

# The env var controlling shared-logger verbosity (read at startup; prod
# default ``info``). Matches the Node logging standard's ``LOG_LEVEL``.
LOG_LEVEL_ENV: str = "LOG_LEVEL"

# --- Log-correlation field keys ------------------------------------------
#
# snake_case, matching the OTel log-correlation convention Grafana's
# Loki<->Tempo derived-field wiring expects and the Node package's
# ``withTraceContext`` (``packages/telemetry/src/logging.ts``). Deliberately
# NOT camelCase like ``reqId`` — this is an OTel wire convention, and the two
# coexist on the same child logger.
TRACE_ID_FIELD: str = "trace_id"
SPAN_ID_FIELD: str = "span_id"
TRACE_LOG_FIELDS: tuple[str, ...] = (TRACE_ID_FIELD, SPAN_ID_FIELD)

# The FuzeFront-local per-request id, camelCase, matching the Node family
# convention (``reqId`` in the logging skill / README). Accepted inbound as the
# ``x-request-id`` header, generated if absent, and propagated downstream as the
# same header.
REQUEST_ID_FIELD: str = "reqId"
REQUEST_ID_HEADER: str = "x-request-id"

# --- Log levels -----------------------------------------------------------
#
# pino's numeric level map, verbatim — the Node family logger is pino, so its
# JSON lines carry these numbers in the ``level`` field. The Python shared
# logger emits the identical shape so a Loki query spanning both languages sorts
# and filters by one ``level`` scale.
LOG_LEVELS: MappingProxyType[str, int] = MappingProxyType(
    {
        "trace": 10,
        "debug": 20,
        "info": 30,
        "warn": 40,
        "error": 50,
        "fatal": 60,
    }
)

# --- OTLP transport -------------------------------------------------------
#
# Local-dev default collector endpoint per transport (the docker-compose service
# name FuzeInfra documents). NOT the in-cluster DNS name — prod sets
# ``OTEL_EXPORTER_OTLP_ENDPOINT`` explicitly via Helm. Matches
# ``DEFAULT_OTLP_ENDPOINT`` in ``packages/telemetry/src/config.ts``.
DEFAULT_OTLP_ENDPOINT: MappingProxyType[str, str] = MappingProxyType(
    {
        "grpc": "http://otel-collector:4317",
        "http": "http://otel-collector:4318",
    }
)

__all__ = [
    "DEFAULT_OTLP_ENDPOINT",
    "LOG_LEVELS",
    "LOG_LEVEL_ENV",
    "OTEL_ENV_VARS",
    "REQUEST_ID_FIELD",
    "REQUEST_ID_HEADER",
    "SPAN_ID_FIELD",
    "TRACE_ID_FIELD",
    "TRACE_LOG_FIELDS",
]
