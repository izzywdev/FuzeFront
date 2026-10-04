import { OTLPTraceExporter as OTLPGrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPHttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { createTraceExporter } from '../src/exporter';
import { resolveTelemetryConfig } from '../src/config';

// We cannot reach a live collector in tests (per the task brief), so these
// assert the SHAPE of what `createTraceExporter` builds — the right exporter
// class for the configured protocol, and that both `shutdown()` cleanly
// without ever having sent anything — rather than a real round trip.

describe('createTraceExporter', () => {
  it('builds an OTLP gRPC exporter for protocol "grpc" (the default)', () => {
    const config = resolveTelemetryConfig({ serviceName: 'svc' }, {});
    const exporter = createTraceExporter(config);
    expect(exporter).toBeInstanceOf(OTLPGrpcTraceExporter);
  });

  it('builds an OTLP HTTP exporter for protocol "http"', () => {
    const config = resolveTelemetryConfig({ serviceName: 'svc', protocol: 'http' }, {});
    const exporter = createTraceExporter(config);
    expect(exporter).toBeInstanceOf(OTLPHttpTraceExporter);
  });

  it('every exporter it builds satisfies the SpanExporter shutdown contract', async () => {
    const grpcExporter = createTraceExporter(resolveTelemetryConfig({ serviceName: 'svc' }, {}));
    const httpExporter = createTraceExporter(
      resolveTelemetryConfig({ serviceName: 'svc', protocol: 'http' }, {})
    );

    await expect(grpcExporter.shutdown()).resolves.toBeUndefined();
    await expect(httpExporter.shutdown()).resolves.toBeUndefined();
  });
});
