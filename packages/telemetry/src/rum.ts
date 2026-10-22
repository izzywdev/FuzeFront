/**
 * @fuzefront/telemetry/browser — Real-User Monitoring (RUM).
 *
 * Closes observability-standard policies P31–P37:
 *  - Core Web Vitals (LCP, CLS, INP, TTFB, FCP) via `web-vitals`, plus
 *    navigation + slow/failed resource timing via `PerformanceObserver`.
 *  - Uncaught errors + unhandled promise rejections.
 *  - A thin leveled browser logger (error/warn/info/debug — same semantics as
 *    the backend's pino levels) for deliberate structured logs.
 *  - Every event carries the active `trace_id` (when a span is active), a
 *    stable per-tab session id, the app release, and the current route.
 *  - Batched, rate-limited, sampled client-side; redacted before it leaves
 *    the device; shipped via `navigator.sendBeacon` (fallback `fetch` with
 *    `keepalive`) to the SAME-ORIGIN ingest route (default `/api/v1/rum`).
 *
 * Contract: telemetry must NEVER throw into the app. Every public function and
 * every browser callback below is wrapped — a failure degrades to "no RUM",
 * never to a broken page.
 *
 * Browser-only: no Node OTel packages are imported here (see tsup.config.ts).
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import type { Metric } from 'web-vitals';
import { getActiveSpanId, getActiveTraceId } from './rum-trace';

/** Same-origin default (root CLAUDE.md: no cross-origin API base). */
export const DEFAULT_RUM_ENDPOINT = '/api/v1/rum';

export type RumLogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<RumLogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export type RumEventType = 'web-vital' | 'navigation' | 'resource' | 'error' | 'log';

export interface RumEvent {
  type: RumEventType;
  /** Epoch ms when the event was captured. */
  ts: number;
  /** Event name: vital name, error kind, log level, `navigation`, `resource`. */
  name: string;
  /** Route (pathname only — no query/hash) at capture time. */
  route: string;
  /** Redacted human-readable message (errors + logs). */
  message?: string;
  /** Numeric value (vitals / timings, ms except CLS which is unitless). */
  value?: number;
  /** Redacted structured attributes. */
  attrs?: Record<string, unknown>;
  trace_id?: string;
  span_id?: string;
}

export interface RumPayload {
  /** Payload schema version. */
  v: 1;
  service: string;
  release: string;
  session_id: string;
  events: RumEvent[];
}

export interface BrowserRumOptions {
  /** Required. Becomes `service` on every payload (e.g. `'fuzefront-frontend'`). */
  serviceName: string;
  /** App release / build id — lets a slow session be tied to a deploy (P35). */
  release?: string;
  /** Ingest URL. Default: same-origin `/api/v1/rum`. */
  endpoint?: string;
  /** Fraction (0..1) of SESSIONS that report vitals/timing/info+debug logs.
   * Errors and error/warn logs are never session-sampled. Default `1`. */
  sampleRate?: number;
  /** Max events shipped per rolling minute (token bucket). Default `60`. */
  maxEventsPerMinute?: number;
  /** Max events per payload. Default `20`. */
  maxBatchSize?: number;
  /** Periodic flush interval in ms. Default `10000`. */
  flushIntervalMs?: number;
  /** Lowest level the logger ships. Default `'warn'`. */
  minLogLevel?: RumLogLevel;
  /** Resources slower than this (ms) are reported. Default `1000`. */
  slowResourceMs?: number;
  /** Max resource events reported per page load. Default `25`. */
  maxResourceEvents?: number;
  /** Override route resolution (default: `location.pathname`). */
  getRoute?: () => string;
}

export interface RumLogger {
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}

export interface BrowserRumHandle {
  readonly sessionId: string;
  readonly logger: RumLogger;
  /** Ship everything queued now (e.g. before a deliberate navigation). */
  flush(): void;
  /** Detach handlers/observers and flush the remainder. */
  stop(): void;
}

// ───────────────────────────── redaction ──────────────────────────────

const REDACTED = '[REDACTED]';
const MAX_STRING = 500;
const MAX_DEPTH = 3;
const MAX_KEYS = 20;

/** Attribute keys whose VALUE is never shipped, whatever it holds. */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|apikey|credential|session[-_]?(id|token)|otp|\bcode\b|ssn|card|cvv|email|phone/i;

/** Value patterns scrubbed out of free-text (messages, stacks, URLs). */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  // Bearer / Basic credentials
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 ' + REDACTED],
  // key=value / key: value style secrets
  [
    /\b(password|passwd|pwd|secret|token|access_token|refresh_token|id_token|api[-_]?key|apikey|client_secret|authorization|code|otp)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;"']+)/gi,
    '$1$2' + REDACTED,
  ],
  // e-mail addresses
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED],
  // long opaque hex / base64-ish blobs (keys, session ids)
  [/\b[A-Fa-f0-9]{32,}\b/g, REDACTED],
];

/** Redacts secrets/PII out of a free-text string and truncates it. */
export function redactString(input: string): string {
  let out = input;
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  return out.length > MAX_STRING ? out.slice(0, MAX_STRING) + '…' : out;
}

/** Strips query + hash (they routinely carry tokens/PII); keeps origin+path. */
export function sanitizeUrl(raw: string): string {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    const u = new URL(raw, base);
    const sameOrigin = typeof location !== 'undefined' && u.origin === location.origin;
    return redactString(sameOrigin ? u.pathname : `${u.origin}${u.pathname}`);
  } catch {
    return redactString(String(raw).split(/[?#]/)[0] ?? '');
  }
}

/** Deep, bounded, key+value redaction of structured attributes. */
export function redactAttrs(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return redactString(`${value.name}: ${value.message}`);
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map(v => redactAttrs(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n++ >= MAX_KEYS) break;
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactAttrs(v, depth + 1);
    }
    return out;
  }
  return undefined; // functions, symbols
}

// ─────────────────────────── session identity ─────────────────────────

const SESSION_KEY = 'fuzefront.rum.sessionId';
let memorySessionId: string | undefined;

function randomId(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const b = c.getRandomValues(new Uint8Array(16));
      return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

/**
 * Stable per-tab session id (P35): minted once, persisted in `sessionStorage`
 * so it survives page loads/reloads in the tab. Falls back to an in-memory id
 * when storage is unavailable (private mode, blocked site data).
 */
export function getRumSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = memorySessionId ?? randomId();
    sessionStorage.setItem(SESSION_KEY, id);
    memorySessionId = id;
    return id;
  } catch {
    memorySessionId ??= randomId();
    return memorySessionId;
  }
}

// ───────────────────────────── transport ──────────────────────────────

/** Ships a payload: `sendBeacon` first, `fetch({keepalive})` as the fallback.
 * Returns true when the browser accepted it for delivery. Never throws. */
export function sendRumPayload(endpoint: string, payload: RumPayload): boolean {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(endpoint, blob)) return true;
    }
    if (typeof fetch === 'function') {
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => undefined);
      return true;
    }
  } catch {
    /* fail open */
  }
  return false;
}

// ───────────────────────────── core ───────────────────────────────────

const noopLogger: RumLogger = { error() {}, warn() {}, info() {}, debug() {} };

function clamp01(n: number | undefined, dflt: number): number {
  return typeof n === 'number' && n >= 0 && n <= 1 ? n : dflt;
}

/**
 * Starts RUM collection ONCE per page load. Call next to
 * `initBrowserTelemetry()` in the app bootstrap. Returns a handle; if
 * anything goes wrong during setup it returns an inert handle instead of
 * throwing.
 */
export function initBrowserRum(options: BrowserRumOptions): BrowserRumHandle {
  const sessionId = getRumSessionId();
  const inert: BrowserRumHandle = { sessionId, logger: noopLogger, flush() {}, stop() {} };
  try {
    if (!options?.serviceName) return inert;
    if (typeof window === 'undefined') return inert;

    const endpoint = options.endpoint || DEFAULT_RUM_ENDPOINT;
    const release = options.release || 'unknown';
    const maxPerMinute = options.maxEventsPerMinute ?? 60;
    const maxBatch = options.maxBatchSize ?? 20;
    const flushMs = options.flushIntervalMs ?? 10_000;
    const minLevel = LEVEL_RANK[options.minLogLevel ?? 'warn'];
    const slowResourceMs = options.slowResourceMs ?? 1000;
    const maxResources = options.maxResourceEvents ?? 25;
    const getRoute =
      options.getRoute ??
      (() => {
        try {
          return location.pathname;
        } catch {
          return '/';
        }
      });
    // Session-level sampling decision, stable for the life of the tab.
    const sampled = Math.random() < clamp01(options.sampleRate, 1);

    let queue: RumEvent[] = [];
    let tokens = maxPerMinute;
    let lastRefill = Date.now();
    let dropped = 0;
    let resourceCount = 0;
    const seenErrors = new Set<string>();
    let stopped = false;

    const takeToken = (): boolean => {
      const now = Date.now();
      const elapsed = now - lastRefill;
      if (elapsed > 0) {
        tokens = Math.min(maxPerMinute, tokens + (elapsed / 60_000) * maxPerMinute);
        lastRefill = now;
      }
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      dropped += 1;
      return false;
    };

    const flush = (): void => {
      try {
        if (queue.length === 0) return;
        const events = queue;
        queue = [];
        // Tell the server what the rate limiter swallowed, once, honestly.
        if (dropped > 0) {
          events.push({
            type: 'log',
            ts: Date.now(),
            name: 'warn',
            route: getRoute(),
            message: 'rum events dropped by client rate limit',
            attrs: { dropped },
          });
          dropped = 0;
        }
        for (let i = 0; i < events.length; i += maxBatch) {
          sendRumPayload(endpoint, {
            v: 1,
            service: options.serviceName,
            release,
            session_id: sessionId,
            events: events.slice(i, i + maxBatch),
          });
        }
      } catch {
        /* fail open */
      }
    };

    const enqueue = (
      ev: Omit<RumEvent, 'ts' | 'route' | 'trace_id' | 'span_id'>,
      opts: { alwaysSend?: boolean } = {}
    ): void => {
      try {
        if (stopped) return;
        if (!sampled && !opts.alwaysSend) return;
        if (!takeToken()) return;
        const traceId = getActiveTraceId();
        const spanId = traceId ? getActiveSpanId() : undefined;
        queue.push({
          ...ev,
          ts: Date.now(),
          route: sanitizeUrl(getRoute()),
          ...(traceId ? { trace_id: traceId } : {}),
          ...(spanId ? { span_id: spanId } : {}),
        });
        if (queue.length >= maxBatch) flush();
      } catch {
        /* fail open */
      }
    };

    // ── Core Web Vitals (P32) ──
    const onVital = (m: Metric): void => {
      enqueue({
        type: 'web-vital',
        name: m.name,
        value: m.value,
        attrs: {
          rating: m.rating,
          delta: m.delta,
          navigationType: m.navigationType,
        },
      });
    };
    try {
      onLCP(onVital);
      onCLS(onVital);
      onINP(onVital);
      onTTFB(onVital);
      onFCP(onVital);
    } catch {
      /* web-vitals unsupported — keep going without it */
    }

    // ── Navigation + resource timing (P32) ──
    const observers: PerformanceObserver[] = [];
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        const nav = new PerformanceObserver(list => {
          for (const e of list.getEntries() as PerformanceNavigationTiming[]) {
            enqueue({
              type: 'navigation',
              name: 'navigation',
              value: e.duration,
              attrs: {
                navigationType: e.type,
                dns: e.domainLookupEnd - e.domainLookupStart,
                connect: e.connectEnd - e.connectStart,
                ttfb: e.responseStart - e.requestStart,
                response: e.responseEnd - e.responseStart,
                domInteractive: e.domInteractive,
                domContentLoaded: e.domContentLoadedEventEnd,
                load: e.loadEventEnd,
                transferSize: e.transferSize,
              },
            });
          }
        });
        nav.observe({ type: 'navigation', buffered: true });
        observers.push(nav);

        const res = new PerformanceObserver(list => {
          for (const e of list.getEntries() as PerformanceResourceTiming[]) {
            if (resourceCount >= maxResources) return;
            if (e.name.includes(endpoint)) continue; // never report ourselves
            const status = (e as { responseStatus?: number }).responseStatus ?? 0;
            const failed = status >= 400;
            if (e.duration < slowResourceMs && !failed) continue;
            resourceCount += 1;
            enqueue(
              {
                type: 'resource',
                name: e.initiatorType || 'resource',
                value: e.duration,
                message: sanitizeUrl(e.name),
                attrs: { transferSize: e.transferSize, status, failed },
              },
              { alwaysSend: failed }
            );
          }
        });
        res.observe({ type: 'resource', buffered: true });
        observers.push(res);
      }
    } catch {
      /* PerformanceObserver type unsupported — vitals still work */
    }

    // ── Uncaught errors + unhandled rejections (P33) ──
    // addEventListener (not window.onerror =) so we never clobber a handler
    // the shell or a federated remote installed.
    const reportError = (kind: string, message: string, stack?: string, attrs?: Record<string, unknown>): void => {
      const msg = redactString(message || 'Unknown error');
      const stk = stack ? redactString(stack) : undefined;
      // De-dupe a crash loop: the same message+stack head ships once per tab.
      const sig = `${kind}|${msg}|${(stk ?? '').slice(0, 120)}`;
      if (seenErrors.has(sig)) return;
      if (seenErrors.size < 200) seenErrors.add(sig);
      enqueue(
        {
          type: 'error',
          name: kind,
          message: msg,
          attrs: { ...(stk ? { stack: stk } : {}), ...(redactAttrs(attrs) as object) },
        },
        { alwaysSend: true }
      );
    };

    const onError = (ev: ErrorEvent): void => {
      try {
        // Resource-load errors bubble here without a message; skip them.
        if (!ev.error && !ev.message) return;
        const err = ev.error as Error | undefined;
        reportError('uncaught_error', err?.message ?? ev.message, err?.stack, {
          filename: ev.filename ? sanitizeUrl(ev.filename) : undefined,
          lineno: ev.lineno,
          colno: ev.colno,
        });
      } catch {
        /* fail open */
      }
    };
    const onRejection = (ev: PromiseRejectionEvent): void => {
      try {
        const r: unknown = ev.reason;
        if (r instanceof Error) reportError('unhandled_rejection', r.message, r.stack);
        else reportError('unhandled_rejection', typeof r === 'string' ? r : safeStringify(r));
      } catch {
        /* fail open */
      }
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    // ── Deliberate structured logs (P34) ──
    const log = (level: RumLogLevel, message: string, fields?: Record<string, unknown>): void => {
      try {
        if (LEVEL_RANK[level] > minLevel) return;
        enqueue(
          {
            type: 'log',
            name: level,
            message: redactString(String(message)),
            ...(fields ? { attrs: redactAttrs(fields) as Record<string, unknown> } : {}),
          },
          { alwaysSend: level === 'error' || level === 'warn' }
        );
      } catch {
        /* fail open */
      }
    };
    const logger: RumLogger = {
      error: (m, f) => log('error', m, f),
      warn: (m, f) => log('warn', m, f),
      info: (m, f) => log('info', m, f),
      debug: (m, f) => log('debug', m, f),
    };

    // ── Flush triggers: interval + page hide (the last chance to beacon) ──
    const timer = setInterval(flush, flushMs);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    return {
      sessionId,
      logger,
      flush,
      stop() {
        try {
          stopped = true;
          clearInterval(timer);
          window.removeEventListener('error', onError);
          window.removeEventListener('unhandledrejection', onRejection);
          window.removeEventListener('pagehide', flush);
          document.removeEventListener('visibilitychange', onVisibility);
          observers.forEach(o => o.disconnect());
          flush();
        } catch {
          /* fail open */
        }
      },
    };
  } catch {
    return inert;
  }
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === 'object' ? JSON.stringify(redactAttrs(v)) : String(v);
  } catch {
    return '[unserializable]';
  }
}
