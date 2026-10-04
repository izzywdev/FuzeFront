import {
  normalizeProtocol,
  parseOtlpHeaders,
  parseSampleRatio,
  resolveTelemetryConfig,
  toHttpTracesUrl,
} from '../src/config';

describe('normalizeProtocol', () => {
  it('maps the standard OTEL_EXPORTER_OTLP_PROTOCOL values', () => {
    expect(normalizeProtocol('grpc')).toBe('grpc');
    expect(normalizeProtocol('http/protobuf')).toBe('http');
    expect(normalizeProtocol('http/json')).toBe('http');
    expect(normalizeProtocol('http')).toBe('http');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeProtocol(' GRPC ')).toBe('grpc');
    expect(normalizeProtocol('HTTP/Protobuf')).toBe('http');
  });

  it('returns undefined for unset/unrecognized values', () => {
    expect(normalizeProtocol(undefined)).toBeUndefined();
    expect(normalizeProtocol('')).toBeUndefined();
    expect(normalizeProtocol('carrier-pigeon')).toBeUndefined();
  });
});

describe('parseOtlpHeaders', () => {
  it('parses the standard k1=v1,k2=v2 form', () => {
    expect(parseOtlpHeaders('x-api-key=abc123,x-tenant=fuzefront')).toEqual({
      'x-api-key': 'abc123',
      'x-tenant': 'fuzefront',
    });
  });

  it('trims whitespace around keys/values and URL-decodes values', () => {
    expect(parseOtlpHeaders(' x-api-key = a%20b ')).toEqual({ 'x-api-key': 'a b' });
  });

  it('skips malformed pairs (no "=") without throwing', () => {
    expect(parseOtlpHeaders('not-a-pair,x-api-key=abc')).toEqual({ 'x-api-key': 'abc' });
  });

  it('returns undefined for unset/empty input', () => {
    expect(parseOtlpHeaders(undefined)).toBeUndefined();
    expect(parseOtlpHeaders('')).toBeUndefined();
  });
});

describe('parseSampleRatio', () => {
  it('parses a valid 0..1 float', () => {
    expect(parseSampleRatio('0.25')).toBe(0.25);
    expect(parseSampleRatio('1')).toBe(1);
    expect(parseSampleRatio('0')).toBe(0);
  });

  it('rejects out-of-range or non-numeric input rather than throwing', () => {
    expect(parseSampleRatio('1.5')).toBeUndefined();
    expect(parseSampleRatio('-0.1')).toBeUndefined();
    expect(parseSampleRatio('not-a-number')).toBeUndefined();
  });

  it('returns undefined when unset', () => {
    expect(parseSampleRatio(undefined)).toBeUndefined();
  });
});

describe('toHttpTracesUrl', () => {
  it('appends /v1/traces when absent', () => {
    expect(toHttpTracesUrl('http://otel-collector:4318')).toBe(
      'http://otel-collector:4318/v1/traces'
    );
  });

  it('is idempotent when /v1/traces is already present', () => {
    expect(toHttpTracesUrl('http://otel-collector:4318/v1/traces')).toBe(
      'http://otel-collector:4318/v1/traces'
    );
  });

  it('strips a trailing slash before appending', () => {
    expect(toHttpTracesUrl('http://otel-collector:4318/')).toBe(
      'http://otel-collector:4318/v1/traces'
    );
  });
});

describe('resolveTelemetryConfig', () => {
  it('requires serviceName', () => {
    // @ts-expect-error — exercising the runtime guard for a JS caller that skips the type check
    expect(() => resolveTelemetryConfig({})).toThrow(/serviceName/);
  });

  it('defaults to grpc + the docker-compose local endpoint + sampleRatio 1 with no env and no options', () => {
    const config = resolveTelemetryConfig({ serviceName: 'my-service' }, {});
    expect(config).toEqual({
      serviceName: 'my-service',
      serviceVersion: undefined,
      otlpEndpoint: 'http://otel-collector:4317',
      protocol: 'grpc',
      sampleRatio: 1,
      resourceAttributes: {},
    });
  });

  it('picks the HTTP default endpoint (port 4318) when protocol is http', () => {
    const config = resolveTelemetryConfig({ serviceName: 'svc', protocol: 'http' }, {});
    expect(config.otlpEndpoint).toBe('http://otel-collector:4318');
  });

  it('explicit options win over env vars', () => {
    const config = resolveTelemetryConfig(
      { serviceName: 'svc', otlpEndpoint: 'http://option-endpoint:9999', protocol: 'http', sampleRatio: 0.5 },
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://env-endpoint:8888',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
        OTEL_TRACES_SAMPLER_ARG: '0.1',
      }
    );
    expect(config.otlpEndpoint).toBe('http://option-endpoint:9999');
    expect(config.protocol).toBe('http');
    expect(config.sampleRatio).toBe(0.5);
  });

  it('falls back to env vars when no matching option is given', () => {
    const config = resolveTelemetryConfig(
      { serviceName: 'svc' },
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://fuzeinfra-otel-collector.fuzeinfra:4317',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        OTEL_TRACES_SAMPLER_ARG: '0.2',
        OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=secret',
      }
    );
    expect(config.otlpEndpoint).toBe('http://fuzeinfra-otel-collector.fuzeinfra:4317');
    expect(config.protocol).toBe('http');
    expect(config.sampleRatio).toBe(0.2);
    expect(config.headers).toEqual({ 'x-api-key': 'secret' });
  });

  it('merges resourceAttributes and carries serviceVersion through untouched', () => {
    const config = resolveTelemetryConfig(
      { serviceName: 'svc', serviceVersion: '1.2.3', resourceAttributes: { 'deployment.environment': 'prod' } },
      {}
    );
    expect(config.serviceVersion).toBe('1.2.3');
    expect(config.resourceAttributes).toEqual({ 'deployment.environment': 'prod' });
  });
});
