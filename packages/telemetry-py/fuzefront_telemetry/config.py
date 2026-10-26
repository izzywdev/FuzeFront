"""fuzefront-telemetry — env-driven config resolution.

The Python peer of ``packages/telemetry/src/config.ts``. Reads the standard
``OTEL_*`` env var, falls back to a package default, never throws on a missing
optional value — the same ``os.environ.get("X") or default`` convention the
Node package uses. An explicit option always wins over the environment.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import unquote

from .contract import DEFAULT_OTLP_ENDPOINT

OtlpProtocol = Literal["grpc", "http"]


@dataclass(frozen=True)
class ResolvedTelemetryConfig:
    """The effective config ``init_telemetry`` builds the exporter from.

    Exposed (returned on the handle) so tests and diagnostics can assert the
    precedence/defaulting without a live collector.
    """

    service_name: str
    otlp_endpoint: str
    protocol: OtlpProtocol
    sample_ratio: float
    service_version: str | None = None
    resource_attributes: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] | None = None


def normalize_protocol(value: str | None) -> OtlpProtocol | None:
    """Normalize ``OTEL_EXPORTER_OTLP_PROTOCOL`` (``grpc`` | ``http/protobuf`` |
    ``http/json``) to this package's ``OtlpProtocol``. Unknown/unset -> ``None``
    so the caller's own default applies. Mirrors ``normalizeProtocol`` in the
    Node package.
    """
    if not value:
        return None
    v = value.strip().lower()
    if v == "grpc":
        return "grpc"
    if v in ("http/protobuf", "http/json", "http"):
        return "http"
    return None


def parse_otlp_headers(value: str | None) -> dict[str, str] | None:
    """Parse the standard ``k1=v1,k2=v2`` form of ``OTEL_EXPORTER_OTLP_HEADERS``."""
    if not value:
        return None
    headers: dict[str, str] = {}
    for pair in value.split(","):
        eq = pair.find("=")
        if eq <= 0:
            continue
        key = pair[:eq].strip()
        val = pair[eq + 1 :].strip()
        if key:
            headers[key] = unquote(val)
    return headers or None


def parse_sample_ratio(value: str | None) -> float | None:
    """Parse ``OTEL_TRACES_SAMPLER_ARG`` as a 0..1 ratio. Out-of-range or
    unparseable input is ignored (falls through to the caller's default) rather
    than producing a nonsensical sampler. Mirrors ``parseSampleRatio``.
    """
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(n) or n < 0 or n > 1:
        return None
    return n


def to_http_traces_url(endpoint: str) -> str:
    """Append ``/v1/traces`` to an OTLP/HTTP endpoint that doesn't already carry
    a signal-specific path. gRPC endpoints have no per-signal path and are
    passed through unchanged. Mirrors ``toHttpTracesUrl``.
    """
    trimmed = endpoint.rstrip("/")
    return trimmed if trimmed.endswith("/v1/traces") else f"{trimmed}/v1/traces"


def resolve_telemetry_config(
    *,
    service_name: str,
    otlp_endpoint: str | None = None,
    protocol: OtlpProtocol | None = None,
    sample_ratio: float | None = None,
    service_version: str | None = None,
    resource_attributes: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    env: dict[str, str] | None = None,
) -> ResolvedTelemetryConfig:
    """Resolve the effective config for ``init_telemetry``.

    Precedence, matching ``resolveTelemetryConfig`` in the Node package:
    explicit option -> standard ``OTEL_*`` env var -> package default.
    """
    if not service_name:
        raise ValueError("init_telemetry: `service_name` is required")

    environ = os.environ if env is None else env

    resolved_protocol: OtlpProtocol = (
        protocol
        or normalize_protocol(environ.get("OTEL_EXPORTER_OTLP_PROTOCOL"))
        or "grpc"
    )

    resolved_endpoint = (
        otlp_endpoint
        or environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        or DEFAULT_OTLP_ENDPOINT[resolved_protocol]
    )

    resolved_ratio = sample_ratio
    if resolved_ratio is None:
        resolved_ratio = parse_sample_ratio(environ.get("OTEL_TRACES_SAMPLER_ARG"))
    if resolved_ratio is None:
        resolved_ratio = 1.0

    resolved_headers = headers
    if resolved_headers is None:
        resolved_headers = parse_otlp_headers(environ.get("OTEL_EXPORTER_OTLP_HEADERS"))

    return ResolvedTelemetryConfig(
        service_name=service_name,
        service_version=service_version,
        otlp_endpoint=resolved_endpoint,
        protocol=resolved_protocol,
        sample_ratio=resolved_ratio,
        resource_attributes=dict(resource_attributes or {}),
        headers=resolved_headers,
    )


__all__ = [
    "OtlpProtocol",
    "ResolvedTelemetryConfig",
    "normalize_protocol",
    "parse_otlp_headers",
    "parse_sample_ratio",
    "resolve_telemetry_config",
    "to_http_traces_url",
]
