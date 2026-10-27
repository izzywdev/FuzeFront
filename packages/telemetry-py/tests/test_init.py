"""init_telemetry wiring — resource, sampler, exporter selection, shutdown.

Like the Node init.test.ts, this builds a real provider but never creates a span
that would be exported, so no network attempt is made.
"""

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.sampling import ParentBased

from fuzefront_telemetry import init_telemetry


def test_builds_provider_with_resolved_config():
    handle = init_telemetry(
        "fuzefront-py-svc",
        service_version="1.2.3",
        sample_ratio=0.5,
        protocol="http",
        otlp_endpoint="http://collector:4318",
        set_global=False,
    )
    try:
        assert isinstance(handle.provider, TracerProvider)
        assert handle.config.service_name == "fuzefront-py-svc"
        assert handle.config.service_version == "1.2.3"
        assert handle.config.sample_ratio == 0.5
        assert handle.config.protocol == "http"
        assert isinstance(handle.provider.sampler, ParentBased)
        attrs = handle.provider.resource.attributes
        assert attrs["service.name"] == "fuzefront-py-svc"
        assert attrs["service.version"] == "1.2.3"
    finally:
        handle.shutdown()


def test_env_only_defaults(monkeypatch):
    for var in (
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_EXPORTER_OTLP_PROTOCOL",
        "OTEL_TRACES_SAMPLER_ARG",
        "OTEL_EXPORTER_OTLP_HEADERS",
    ):
        monkeypatch.delenv(var, raising=False)
    handle = init_telemetry("svc", set_global=False)
    try:
        assert handle.config.protocol == "grpc"
        assert handle.config.otlp_endpoint == "http://otel-collector:4317"
        assert handle.config.sample_ratio == 1.0
    finally:
        handle.shutdown()
