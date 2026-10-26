"""Shared in-memory tracing setup for the middleware/sampler tests.

No live collector is reachable from this repo's dev/CI environment, so spans are
captured with an InMemorySpanExporter + SimpleSpanProcessor and asserted
directly — the Python analog of the Node package's InMemorySpanExporter tests.
"""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.sampling import ALWAYS_ON, ParentBased, Sampler


def build_provider(sampler: Sampler = ALWAYS_ON) -> tuple[TracerProvider, InMemorySpanExporter]:
    exporter = InMemorySpanExporter()
    provider = TracerProvider(sampler=sampler)
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider, exporter


@pytest.fixture
def provider_and_exporter():
    provider, exporter = build_provider(ParentBased(root=ALWAYS_ON))
    yield provider, exporter
    provider.shutdown()
