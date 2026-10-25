# fuzefront-telemetry (Python)

OpenTelemetry **distributed tracing** + the family **structured-logging contract**
for Python FuzeFront-family microservices. The Python peer of
[`@izzywdev/fuzefront-telemetry`](../telemetry) (Node) — pinned to the same
contract so a trace or log line from a Python service is readable alongside one
from a Node service.

Policy: [`governance/observability-standard.md`](../../governance/observability-standard.md)
(closes P4, P28, P39, P41 and the Python half of P19/P21/P24).

## What it gives you

- `init_telemetry(service_name, ...)` — bootstraps the OTel Python SDK once per
  process: a `ParentBased(TraceIdRatioBased)` sampler, an OTLP exporter (gRPC or
  HTTP) pointed at FuzeInfra's Collector via the same `OTEL_*` env the Node
  package reads.
- `TelemetryASGIMiddleware` (FastAPI / Starlette) and `TelemetryWSGIMiddleware`
  + `instrument_flask(app)` (Flask) — one SERVER span per request with the
  **matched route template** (never the raw path), status and elapsed ms, plus
  an entry/exit structured log.
- `with_trace_context(logger, request)` — binds `trace_id`/`span_id` (snake_case,
  matching Node) and `reqId` (camelCase, the family convention); accepts an
  inbound `x-request-id` / `traceparent` and propagates `x-request-id`.
- `get_logger()` / `StructuredLogger` — the one shared pino-shaped JSON logger
  (numeric `level`, `time` in ms, `LOG_LEVEL` env, prod default `info`), with
  secret redaction from the **single family source**
  `governance/observability-redaction-paths.json`.

## Node parity

The cross-language contract lives in `fuzefront_telemetry/contract.py` — the same
`OTEL_*` env var names, the same `trace_id`/`span_id`/`reqId` log keys, the same
pino level numbers, and the same redaction list (loaded from the shared JSON).
`scripts/gate_telemetry_parity.py` reads those values straight out of the Node
package source and **fails CI on any drift**, mirroring
`gate_identifier.py --registry-parity`. It runs on every PR (`harden-gate.yml`)
and before every publish.

## Usage

### FastAPI / Starlette (ASGI)

```python
from fuzefront_telemetry import init_telemetry, TelemetryASGIMiddleware, get_logger, with_trace_context

init_telemetry("fuzefront-py-svc", service_version="1.0.0")  # once, at startup

app.add_middleware(TelemetryASGIMiddleware)

@app.get("/users/{user_id}")
async def get_user(user_id: str, request: Request):
    log = with_trace_context(get_logger(), request.scope)
    log.info({"user_id": user_id}, "fetched user")   # carries reqId AND trace_id/span_id
    ...
```

### Flask (WSGI)

```python
from fuzefront_telemetry import init_telemetry, instrument_flask

init_telemetry("fuzefront-py-svc")
instrument_flask(app)   # wires the matched url_rule in as the route template
```

A generic WSGI app records its template with `set_matched_route(environ, "/users/<id>")`.

## Env resolution (matches the Node package)

| Option | Env var | Default |
| --- | --- | --- |
| `otlp_endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` (grpc) / `:4318` (http) |
| `protocol` | `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc`\|`http/protobuf`\|`http/json`) | `grpc` |
| `sample_ratio` | `OTEL_TRACES_SAMPLER_ARG` (0..1) | `1` |
| `headers` | `OTEL_EXPORTER_OTLP_HEADERS` (`k1=v1,k2=v2`) | none |

An explicit argument always wins over the environment. Production/k8s sets
`OTEL_EXPORTER_OTLP_ENDPOINT` explicitly via Helm; this package does not hardcode
the in-cluster collector DNS name.

## Install (private — GitHub Release asset)

Like `fuzefront-identity`, there is no PyPI registry for this private family
package; the wheel is attached to a GitHub Release (tag `telemetry-py-vX.Y.Z`):

```bash
pip install https://github.com/izzywdev/FuzeFront/releases/download/telemetry-py-v1.0.0/fuzefront_telemetry-1.0.0-py3-none-any.whl
# or, from source:
pip install "git+https://github.com/izzywdev/FuzeFront.git@telemetry-py-v1.0.0#subdirectory=packages/telemetry-py"
```

Optional framework extras: `fuzefront-telemetry[fastapi]`, `fuzefront-telemetry[flask]`.

## Develop / test

```bash
cd packages/telemetry-py
pip install -e '.[dev]'
pytest -q
python ../../scripts/gate_telemetry_parity.py ../..   # Node<->Python parity
```

No live collector is reachable from this repo's dev/CI environment, so the tests
capture spans with an in-memory exporter and assert them directly — the Python
analog of the Node package's `InMemorySpanExporter` tests.
