/**
 * @jest-environment jsdom
 */
import { context, trace } from '@opentelemetry/api';
import { StackContextManager } from '@opentelemetry/sdk-trace-web';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

jest.mock('web-vitals', () => ({
  onLCP: jest.fn(),
  onCLS: jest.fn(),
  onINP: jest.fn(),
  onTTFB: jest.fn(),
  onFCP: jest.fn(),
}));

import * as webVitals from 'web-vitals';
import {
  getRumSessionId,
  initBrowserRum,
  redactAttrs,
  redactString,
  sanitizeUrl,
  sendRumPayload,
} from '../src/rum';
import type { BrowserRumHandle, RumPayload } from '../src/rum';

const beacon = jest.fn<boolean, [string, Blob]>();

async function lastPayloads(): Promise<RumPayload[]> {
  return Promise.all(
    beacon.mock.calls.map(async ([, blob]) => JSON.parse(await blobText(blob)) as RumPayload)
  );
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

async function flushedEvents(handle: BrowserRumHandle) {
  handle.flush();
  const payloads = await lastPayloads();
  return payloads.flatMap(p => p.events);
}

describe('rum', () => {
  let handle: BrowserRumHandle | undefined;

  beforeEach(() => {
    beacon.mockReset().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    handle?.stop();
    handle = undefined;
    trace.disable();
    context.disable();
  });

  describe('web-vitals wiring (P32)', () => {
    it('subscribes to LCP, CLS, INP, TTFB and FCP', () => {
      handle = initBrowserRum({ serviceName: 'svc' });
      expect(webVitals.onLCP).toHaveBeenCalledTimes(1);
      expect(webVitals.onCLS).toHaveBeenCalledTimes(1);
      expect(webVitals.onINP).toHaveBeenCalledTimes(1);
      expect(webVitals.onTTFB).toHaveBeenCalledTimes(1);
      expect(webVitals.onFCP).toHaveBeenCalledTimes(1);
    });

    it('turns a reported metric into a web-vital event', async () => {
      handle = initBrowserRum({ serviceName: 'svc', release: '1.2.3' });
      const report = (webVitals.onLCP as jest.Mock).mock.calls[0][0];
      report({ name: 'LCP', value: 1234, delta: 1234, rating: 'good', navigationType: 'navigate' });
      const events = await flushedEvents(handle);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'web-vital',
        name: 'LCP',
        value: 1234,
        attrs: { rating: 'good' },
      });
    });
  });

  describe('error capture (P33)', () => {
    it('captures an uncaught error with redacted message + stack', async () => {
      handle = initBrowserRum({ serviceName: 'svc' });
      const err = new Error('boom password=hunter2');
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }));
      const events = await flushedEvents(handle);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].name).toBe('uncaught_error');
      expect(events[0].message).toContain('boom');
      expect(JSON.stringify(events[0])).not.toContain('hunter2');
    });

    it('captures an unhandled rejection', async () => {
      handle = initBrowserRum({ serviceName: 'svc' });
      const ev = new Event('unhandledrejection') as Event & { reason: unknown };
      ev.reason = new Error('rejected');
      window.dispatchEvent(ev);
      const events = await flushedEvents(handle);
      expect(events[0]).toMatchObject({
        type: 'error',
        name: 'unhandled_rejection',
        message: 'rejected',
      });
    });

    it('de-duplicates an identical crash loop', async () => {
      handle = initBrowserRum({ serviceName: 'svc' });
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new ErrorEvent('error', { error: new Error('same'), message: 'same' }));
      }
      expect(await flushedEvents(handle)).toHaveLength(1);
    });

    it('ignores message-less resource errors', async () => {
      handle = initBrowserRum({ serviceName: 'svc' });
      window.dispatchEvent(new ErrorEvent('error'));
      expect(await flushedEvents(handle)).toHaveLength(0);
    });
  });

  describe('payload shape + identity (P35)', () => {
    it('carries service, release, session id, route and trace id', async () => {
      const provider = new WebTracerProvider();
      context.setGlobalContextManager(new StackContextManager().enable());
      trace.setGlobalTracerProvider(provider);
      handle = initBrowserRum({ serviceName: 'fuzefront-frontend', release: '9.9.9' });
      const span = provider.getTracer('t').startSpan('op');
      context.with(trace.setSpan(context.active(), span), () => {
        handle!.logger.error('traced failure');
      });
      handle.flush();
      const [payload] = await lastPayloads();
      expect(payload).toMatchObject({
        v: 1,
        service: 'fuzefront-frontend',
        release: '9.9.9',
        session_id: handle.sessionId,
      });
      expect(payload.events[0].trace_id).toBe(span.spanContext().traceId);
      expect(payload.events[0].route).toBe('/');
      expect(beacon.mock.calls[0][0]).toBe('/api/v1/rum');
    });

    it('keeps the session id stable across init calls (same tab)', () => {
      const a = getRumSessionId();
      handle = initBrowserRum({ serviceName: 'svc' });
      expect(handle.sessionId).toBe(a);
      expect(getRumSessionId()).toBe(a);
      expect(sessionStorage.getItem('fuzefront.rum.sessionId')).toBe(a);
    });

    it('falls back to a stable in-memory id when sessionStorage throws', () => {
      const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const setSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      try {
        const a = getRumSessionId();
        expect(a).toBeTruthy();
        expect(getRumSessionId()).toBe(a);
      } finally {
        spy.mockRestore();
        setSpy.mockRestore();
      }
    });
  });

  describe('logger (P34)', () => {
    it('applies level semantics: default ships warn+error only', async () => {
      handle = initBrowserRum({ serviceName: 'svc' });
      handle.logger.debug('d');
      handle.logger.info('i');
      handle.logger.warn('w');
      handle.logger.error('e');
      const events = await flushedEvents(handle);
      expect(events.map(e => e.name)).toEqual(['warn', 'error']);
    });

    it('minLogLevel=debug ships everything', async () => {
      handle = initBrowserRum({ serviceName: 'svc', minLogLevel: 'debug' });
      handle.logger.debug('d');
      handle.logger.info('i');
      expect((await flushedEvents(handle)).map(e => e.name)).toEqual(['debug', 'info']);
    });

    it('redacts sensitive attribute keys and values', async () => {
      handle = initBrowserRum({ serviceName: 'svc' });
      handle.logger.error('login failed for bob@example.com', {
        password: 'p',
        nested: { access_token: 'abc', ok: 'fine' },
        note: 'Bearer abcdef123456',
      });
      const [e] = await flushedEvents(handle);
      const s = JSON.stringify(e);
      expect(s).not.toContain('bob@example.com');
      expect(s).not.toContain('abcdef123456');
      expect(e.attrs).toMatchObject({
        password: '[REDACTED]',
        nested: { access_token: '[REDACTED]', ok: 'fine' },
      });
    });
  });

  describe('rate limiting + sampling (P36)', () => {
    it('drops events beyond the per-minute budget and reports the drop count', async () => {
      handle = initBrowserRum({ serviceName: 'svc', maxEventsPerMinute: 3, maxBatchSize: 100 });
      for (let i = 0; i < 10; i++) handle.logger.error(`e${i}`);
      const events = await flushedEvents(handle);
      expect(events.filter(e => e.message?.startsWith('e'))).toHaveLength(3);
      expect(events[events.length - 1].attrs).toMatchObject({ dropped: 7 });
    });

    it('sampleRate=0 suppresses vitals and info logs but never errors', async () => {
      handle = initBrowserRum({ serviceName: 'svc', sampleRate: 0, minLogLevel: 'info' });
      (webVitals.onLCP as jest.Mock).mock.calls[0][0]({ name: 'LCP', value: 1 });
      handle.logger.info('quiet');
      handle.logger.error('loud');
      const events = await flushedEvents(handle);
      expect(events.map(e => e.message)).toEqual(['loud']);
    });

    it('splits large queues into batches of maxBatchSize', async () => {
      handle = initBrowserRum({ serviceName: 'svc', maxBatchSize: 2, maxEventsPerMinute: 100 });
      for (let i = 0; i < 5; i++) handle.logger.error(`e${i}`);
      handle.flush();
      const payloads = await lastPayloads();
      expect(payloads.every(p => p.events.length <= 2)).toBe(true);
      expect(payloads.flatMap(p => p.events)).toHaveLength(5);
    });
  });

  describe('fail-open (never throws into the app)', () => {
    it('returns an inert handle without a serviceName', () => {
      // @ts-expect-error — exercising the runtime guard for a JS caller
      handle = initBrowserRum({});
      expect(() => {
        handle!.logger.error('x');
        handle!.flush();
        handle!.stop();
      }).not.toThrow();
      expect(beacon).not.toHaveBeenCalled();
    });

    it('survives sendBeacon throwing and web-vitals throwing', () => {
      beacon.mockImplementation(() => {
        throw new Error('beacon down');
      });
      (webVitals.onLCP as jest.Mock).mockImplementationOnce(() => {
        throw new Error('unsupported');
      });
      handle = initBrowserRum({ serviceName: 'svc' });
      handle.logger.error('x');
      expect(() => handle!.flush()).not.toThrow();
    });

    it('falls back to fetch keepalive when sendBeacon refuses', () => {
      beacon.mockReturnValue(false);
      const f = jest.fn().mockResolvedValue({ ok: true });
      (global as unknown as { fetch: unknown }).fetch = f;
      const ok = sendRumPayload('/api/v1/rum', {
        v: 1,
        service: 's',
        release: 'r',
        session_id: 'x',
        events: [],
      });
      expect(ok).toBe(true);
      expect(f).toHaveBeenCalledWith(
        '/api/v1/rum',
        expect.objectContaining({ method: 'POST', keepalive: true })
      );
    });

    it('flushes on pagehide', async () => {
      handle = initBrowserRum({ serviceName: 'svc' });
      handle.logger.error('last words');
      window.dispatchEvent(new Event('pagehide'));
      expect((await lastPayloads()).flatMap(p => p.events)).toHaveLength(1);
    });
  });

  describe('redaction helpers', () => {
    it('strips query and hash from URLs', () => {
      expect(sanitizeUrl('/a/b?token=abc#frag')).toBe('/a/b');
      expect(sanitizeUrl('https://cdn.example.com/x.js?sig=1')).toBe('https://cdn.example.com/x.js');
    });

    it('scrubs JWTs and long hex blobs from strings', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sgnature12';
      expect(redactString(`auth ${jwt}`)).not.toContain('eyJhbGci');
      expect(redactString('id ' + 'a'.repeat(40))).toContain('[REDACTED]');
    });

    it('bounds depth and key count', () => {
      const deep = { a: { b: { c: { d: 1 } } } };
      expect(JSON.stringify(redactAttrs(deep))).toContain('[Truncated]');
    });
  });
});
