"""ParentBased sampling: a continued (child) trace is never dropped by a low
root ratio, mirroring the Node package's ParentBasedSampler guarantee.
"""

from conftest import build_provider
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.trace import SpanKind
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator


def test_root_dropped_at_ratio_zero():
    provider, exporter = build_provider(ParentBased(root=TraceIdRatioBased(0.0)))
    try:
        tracer = provider.get_tracer("t")
        tracer.start_span("GET", kind=SpanKind.SERVER).end()
        assert exporter.get_finished_spans() == ()
    finally:
        provider.shutdown()


def test_child_inherits_sampled_parent_despite_ratio_zero():
    """An inbound traceparent with the sampled flag set must be recorded even
    though the root ratio is 0 — the whole point of ParentBased."""
    provider, exporter = build_provider(ParentBased(root=TraceIdRatioBased(0.0)))
    try:
        tracer = provider.get_tracer("t")
        carrier = {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
        }
        parent = TraceContextTextMapPropagator().extract(carrier)
        span = tracer.start_span("GET", context=parent, kind=SpanKind.SERVER)
        span.end()
        finished = exporter.get_finished_spans()
        assert len(finished) == 1
        assert format(finished[0].context.trace_id, "032x") == "4bf92f3577b34da6a3ce929d0e0e4736"
    finally:
        provider.shutdown()
