import { initTelemetry } from '../src/init';
import type { TelemetryHandle } from '../src/types';

// `initTelemetry` starts `NodeSDK`, which patches globals (http, express) via
// its instrumentations but makes NO network call by itself — OTLP export only
// happens when a span is actually flushed, which none of these tests trigger
// (no live collector reachable in this environment, per the task brief).
// Each test asserts the RESOLVED config the SDK was built from (`handle.
// config`), then shuts the SDK down to undo the global patching before the
// next test runs.
describe('initTelemetry', () => {
  const ORIGINAL_ENV = process.env;
  let handle: TelemetryHandle | undefined;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(async () => {
    process.env = ORIGINAL_ENV;
    await handle?.shutdown();
    handle = undefined;
  });

  it('defaults to the gRPC transport + local-dev endpoint + sample-everything', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
    delete process.env.OTEL_TRACES_SAMPLER_ARG;

    handle = initTelemetry({ serviceName: 'fuzefront-security' });

    expect(handle.config).toEqual({
      serviceName: 'fuzefront-security',
      serviceVersion: undefined,
      otlpEndpoint: 'http://otel-collector:4317',
      protocol: 'grpc',
      sampleRatio: 1,
      resourceAttributes: {},
    });
  });

  it('honors an explicit HTTP protocol + endpoint override', () => {
    handle = initTelemetry({
      serviceName: 'fuzefront-security',
      protocol: 'http',
      otlpEndpoint: 'http://fuzeinfra-otel-collector.fuzeinfra:4318',
    });

    expect(handle.config.protocol).toBe('http');
    expect(handle.config.otlpEndpoint).toBe('http://fuzeinfra-otel-collector.fuzeinfra:4318');
  });

  it('picks up OTEL_* env vars end-to-end when no matching option is passed', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://fuzeinfra-otel-collector.fuzeinfra:4317';
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
    process.env.OTEL_TRACES_SAMPLER_ARG = '0.1';

    handle = initTelemetry({ serviceName: 'fuzefront-security' });

    expect(handle.config.otlpEndpoint).toBe('http://fuzeinfra-otel-collector.fuzeinfra:4317');
    expect(handle.config.protocol).toBe('grpc');
    expect(handle.config.sampleRatio).toBe(0.1);
  });

  it('an explicit option always wins over the environment', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-wins:4317';

    handle = initTelemetry({ serviceName: 'svc', otlpEndpoint: 'http://option-wins:4317' });

    expect(handle.config.otlpEndpoint).toBe('http://option-wins:4317');
  });

  it('rejects a missing serviceName before touching the SDK at all', () => {
    // @ts-expect-error — exercising the runtime guard for a JS caller that skips the type check
    expect(() => initTelemetry({})).toThrow(/serviceName/);
  });

  it('shutdown() resolves cleanly with nothing exported', async () => {
    handle = initTelemetry({ serviceName: 'svc' });
    await expect(handle.shutdown()).resolves.toBeUndefined();
    handle = undefined; // already shut down; afterEach should not double-shutdown
  });
});
