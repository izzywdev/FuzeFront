"""fuzefront-telemetry — ``init_telemetry`` (OTel Python SDK bootstrap).

The Python peer of ``initTelemetry`` (``packages/telemetry/src/init.py``).
Builds a ``TracerProvider`` ONCE per process with:

- a ``Resource`` carrying ``service.name`` (and ``service.version`` when given),
- a ``ParentBased(TraceIdRatioBased(sample_ratio))`` sampler — so a NEW (root)
  trace is sampled per ``sample_ratio`` while a span continuing an inbound
  ``traceparent`` always inherits its parent's decision, never fragmenting a
  trace already recorded upstream,
- an OTLP span exporter (gRPC or HTTP, selected by ``protocol``) pointed at
  FuzeInfra's Collector via the shared ``OTEL_*`` env, wrapped in a
  ``BatchSpanProcessor``.

Call it before the app starts handling requests. The default global propagator
(W3C TraceContext + Baggage) is what the tracing middleware's ``extract`` reads,
so an inbound ``traceparent`` continues the same trace.
"""

from __future__ import annotations

from dataclasses import dataclass

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.semconv.resource import ResourceAttributes

from .config import (
    OtlpProtocol,
    ResolvedTelemetryConfig,
    resolve_telemetry_config,
    to_http_traces_url,
)


@dataclass
class TelemetryHandle:
    """Returned by ``init_telemetry``. ``config`` is the resolved config actually
    used; ``shutdown()`` flushes + stops the provider on graceful shutdown.
    """

    config: ResolvedTelemetryConfig
    provider: TracerProvider

    def shutdown(self) -> None:
        self.provider.shutdown()


def _build_exporter(config: ResolvedTelemetryConfig):
    if config.protocol == "http":
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

        return OTLPSpanExporter(
            endpoint=to_http_traces_url(config.otlp_endpoint),
            headers=config.headers or None,
        )
    # gRPC. Headers are forwarded as a tuple of (key, value) pairs, which the
    # gRPC exporter accepts directly (unlike the Node gRPC exporter, which wants
    # a grpc.Metadata instance — see the Node exporter's note).
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

    return OTLPSpanExporter(
        endpoint=config.otlp_endpoint,
        headers=tuple(config.headers.items()) if config.headers else None,
    )


def init_telemetry(
    service_name: str,
    *,
    otlp_endpoint: str | None = None,
    protocol: OtlpProtocol | None = None,
    sample_ratio: float | None = None,
    service_version: str | None = None,
    resource_attributes: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    set_global: bool = True,
) -> TelemetryHandle:
    """Bootstrap the OTel Python SDK once per process.

    Args mirror the Node ``TelemetryOptions``; all but ``service_name`` default
    from the standard ``OTEL_*`` env vars (see ``config.resolve_telemetry_config``).
    ``set_global=False`` registers a standalone provider without touching the
    global tracer provider (useful in tests).
    """
    config = resolve_telemetry_config(
        service_name=service_name,
        otlp_endpoint=otlp_endpoint,
        protocol=protocol,
        sample_ratio=sample_ratio,
        service_version=service_version,
        resource_attributes=resource_attributes,
        headers=headers,
    )

    attributes: dict[str, str] = {ResourceAttributes.SERVICE_NAME: config.service_name}
    if config.service_version:
        attributes[ResourceAttributes.SERVICE_VERSION] = config.service_version
    attributes.update(config.resource_attributes)

    provider = TracerProvider(
        resource=Resource.create(attributes),
        sampler=ParentBased(root=TraceIdRatioBased(config.sample_ratio)),
    )
    provider.add_span_processor(BatchSpanProcessor(_build_exporter(config)))

    if set_global:
        trace.set_tracer_provider(provider)

    return TelemetryHandle(config=config, provider=provider)


__all__ = ["TelemetryHandle", "init_telemetry"]
