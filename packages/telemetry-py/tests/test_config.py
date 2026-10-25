"""Config resolution: option > env > default, and the OTEL_* parsers.

Mirrors the Node package's config.test.ts precedence assertions.
"""

import pytest

from fuzefront_telemetry import (
    normalize_protocol,
    parse_otlp_headers,
    parse_sample_ratio,
    resolve_telemetry_config,
    to_http_traces_url,
)


def test_defaults_when_env_empty():
    cfg = resolve_telemetry_config(service_name="svc", env={})
    assert cfg.protocol == "grpc"
    assert cfg.otlp_endpoint == "http://otel-collector:4317"
    assert cfg.sample_ratio == 1.0
    assert cfg.headers is None


def test_http_default_endpoint_port():
    cfg = resolve_telemetry_config(service_name="svc", protocol="http", env={})
    assert cfg.otlp_endpoint == "http://otel-collector:4318"


def test_env_fills_when_option_absent():
    env = {
        "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector.internal:4318",
        "OTEL_TRACES_SAMPLER_ARG": "0.25",
        "OTEL_EXPORTER_OTLP_HEADERS": "x-auth=secret-value,x-env=prod",
    }
    cfg = resolve_telemetry_config(service_name="svc", env=env)
    assert cfg.protocol == "http"
    assert cfg.otlp_endpoint == "http://collector.internal:4318"
    assert cfg.sample_ratio == 0.25
    assert cfg.headers == {"x-auth": "secret-value", "x-env": "prod"}


def test_explicit_option_beats_env():
    env = {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://from-env:4317"}
    cfg = resolve_telemetry_config(
        service_name="svc", otlp_endpoint="http://from-option:4317", env=env
    )
    assert cfg.otlp_endpoint == "http://from-option:4317"


def test_service_name_required():
    with pytest.raises(ValueError):
        resolve_telemetry_config(service_name="", env={})


def test_normalize_protocol():
    assert normalize_protocol("grpc") == "grpc"
    assert normalize_protocol("http/protobuf") == "http"
    assert normalize_protocol("http/json") == "http"
    assert normalize_protocol("nonsense") is None
    assert normalize_protocol(None) is None


def test_parse_sample_ratio_bounds():
    assert parse_sample_ratio("0") == 0.0
    assert parse_sample_ratio("1") == 1.0
    assert parse_sample_ratio("0.5") == 0.5
    assert parse_sample_ratio("1.5") is None
    assert parse_sample_ratio("-0.1") is None
    assert parse_sample_ratio("abc") is None
    assert parse_sample_ratio(None) is None


def test_parse_otlp_headers():
    assert parse_otlp_headers("a=1,b=2") == {"a": "1", "b": "2"}
    assert parse_otlp_headers("") is None
    assert parse_otlp_headers(None) is None


def test_to_http_traces_url():
    assert to_http_traces_url("http://c:4318") == "http://c:4318/v1/traces"
    assert to_http_traces_url("http://c:4318/") == "http://c:4318/v1/traces"
    assert to_http_traces_url("http://c:4318/v1/traces") == "http://c:4318/v1/traces"
