// lib/logger.ts — the ONE shared structured logger for selection-list-service.
//
// Family standard (.claude/skills/logging/SKILL.md):
//   - pino, structured JSON to stdout (Loki ingests JSON; console.* is
//     unleveled, unstructured and unredacted, and is banned in src/).
//   - LOG_LEVEL env var, read at startup (default `info`) — flip to `debug`
//     for an incident with a restart, no rebuild.
//   - A per-request `reqId` child logger bound by `requestLogger` middleware.
//     It also lives in an AsyncLocalStorage so code that never sees `req`
//     (the Security API fetch hook, `getLog()`) still logs on the same thread.
//   - MANDATORY redaction at the logger: authorization/cookie headers, tokens,
//     passwords, codes, secrets. Call sites never have to remember.
//   - Boundary logging: every external call logs start + end + elapsed ms.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      /** Request-scoped child logger (carries reqId). Use `getLog(req)`. */
      log?: Logger;
      /** Correlation id: inbound x-request-id if well-formed, else a UUID. */
      reqId?: string;
    }
  }
}

export const SERVICE_NAME = 'selection-list-service';

/** Secret paths censored at the logger. If in doubt, redact. */
export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.headers.authorization',
  '*.headers.cookie',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  // NOT a blanket '*.code': the serialized error carries `err.code` (ECONNRESET,
  // ENOTFOUND, pg 23505, ...) which is exactly what an incident needs. Auth /
  // OTP codes are redacted by their concrete locations instead.
  'query.code',
  'body.code',
  'req.query.code',
  'req.body.code',
  '*.authorization_code',
  '*.auth_code',
  'authorization_code',
  'auth_code',
  'otp',
  '*.otp',
  '*.client_secret',
  '*.apiKey',
  '*.secret',
  'password',
  'token',
  'authorization',
  'cookie',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'apiKey',
  'secret',
];

function defaultLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  // Unit tests (jest sets JEST_WORKER_ID) assert on behaviour, not log noise;
  // they opt in via LOG_LEVEL or by building their own logger with
  // createLogger(). NODE_ENV=test alone is NOT silenced: the CI integration job
  // runs the real service under NODE_ENV=test and dumps its log on failure.
  return process.env.JEST_WORKER_ID ? 'silent' : 'info';
}

/**
 * Build a logger with the family options. Exported so tests can capture output
 * through a custom destination; service code uses the shared `logger` below.
 */
export function createLogger(level: string = defaultLevel(), destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: process.env.SERVICE_NAME ?? SERVICE_NAME },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
  return destination ? pino(options, destination) : pino(options);
}

/** The root logger. Everything derives from it via `.child()`. */
export const logger: Logger = createLogger();

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------

interface RequestContext {
  reqId: string;
  log: Logger;
}

const als = new AsyncLocalStorage<RequestContext>();

/** The active request's context, if called inside a request. */
export function currentRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/** The request-scoped logger, falling back to ALS context, then the root logger. */
export function getLog(req?: Request): Logger {
  return req?.log ?? als.getStore()?.log ?? logger;
}

const REQ_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Accept an inbound x-request-id only if it is a short, log-safe token. */
function resolveReqId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && REQ_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

/** Strip the query string — it can carry tokens and is never logged. */
function pathOf(req: Request): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0];
}

/**
 * Entry middleware: binds `reqId` (+ route/method) onto a child logger, echoes
 * the id back as `x-request-id`, and logs request start (debug) and completion
 * (info; error for 5xx). A 4xx is a normal answer, not a degradation, so it is
 * not escalated. Health probes log at debug so kubelet polling does not drown
 * the story.
 */
export function createRequestLogger(root: Logger = logger) {
  return function requestLogger(req: Request, res: Response, next: NextFunction): void {
    const reqId = resolveReqId(req.headers['x-request-id']);
    const path = pathOf(req);
    const log = root.child({ reqId, method: req.method, route: path });
    req.reqId = reqId;
    req.log = log;
    res.setHeader('x-request-id', reqId);

    const isProbe =
      path === '/health' || path.startsWith('/health/') || path === '/ready' || path === '/metrics';
    const started = performance.now();
    log.debug('request received');

    res.on('finish', () => {
      const fields = {
        status: res.statusCode,
        elapsedMs: Math.round(performance.now() - started),
        userId: req.userId,
        orgId: req.orgId,
      };
      if (res.statusCode >= 500) log.error(fields, 'request completed');
      else if (isProbe) log.debug(fields, 'request completed');
      else log.info(fields, 'request completed');
    });

    als.run({ reqId, log }, next);
  };
}

export const requestLogger = createRequestLogger();

// ---------------------------------------------------------------------------
// Boundary helpers
// ---------------------------------------------------------------------------

/**
 * Wrap an external call (DB, HTTP, ...) with start / end / elapsed-ms logs.
 * A failure is logged at ERROR with the op + elapsed and then re-thrown — the
 * caller still decides how to handle it (fail closed, 500, ...).
 */
export async function timed<T>(
  log: Logger,
  op: string,
  fn: () => Promise<T>,
  ctx: Record<string, unknown> = {},
): Promise<T> {
  const start = performance.now();
  log.debug({ op, ...ctx }, `${op} start`);
  try {
    const out = await fn();
    log.debug({ op, ...ctx, elapsedMs: Math.round(performance.now() - start) }, `${op} end`);
    return out;
  } catch (err) {
    log.error({ op, ...ctx, elapsedMs: Math.round(performance.now() - start), err }, `${op} failed`);
    throw err;
  }
}

/** Slow dependency threshold: an end log at or above this is a WARN. */
export const SLOW_CALL_MS = 1000;

type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: unknown;
};
type FetchResult = { ok: boolean; status: number; json(): Promise<unknown> };
export type LoggedFetch = (url: string, init: FetchInit) => Promise<FetchResult>;

/**
 * A `fetch` for the Security API client (`createAuthzClient({ fetch })`).
 *
 * - propagates the request's `reqId` as `x-request-id`, so Security's logs join
 *   the same thread;
 * - logs start (debug) / end (debug; warn when slow or non-2xx) with elapsedMs
 *   and the HTTP status. Failures (timeouts, DNS, resets) log at error and are
 *   re-thrown untouched — the authz client turns every one into a deny.
 *
 * Never logs the Authorization header or body (redaction is the backstop, but
 * the value is simply never put on the log line).
 *
 * `base` defaults to the global fetch; when none exists this returns
 * `undefined` so `createAuthzClient` raises its own AUTHZ_MISCONFIGURED.
 */
export function createLoggedFetch(
  base: LoggedFetch | undefined = typeof globalThis.fetch === 'function'
    ? (globalThis.fetch.bind(globalThis) as unknown as LoggedFetch)
    : undefined,
): LoggedFetch | undefined {
  if (!base) return undefined;
  return async function loggedFetch(url, init) {
    const ctx = currentRequestContext();
    const log = ctx?.log ?? logger;
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      /* keep the raw url — it carries no credentials by construction */
    }
    const op = 'securityapi.request';
    const headers = ctx ? { ...init.headers, 'x-request-id': ctx.reqId } : init.headers;
    const start = performance.now();
    log.debug({ op, httpMethod: init.method, path }, `${op} start`);
    try {
      const res = await base(url, { ...init, headers });
      const elapsedMs = Math.round(performance.now() - start);
      const fields = { op, httpMethod: init.method, path, status: res.status, elapsedMs };
      if (!res.ok || elapsedMs >= SLOW_CALL_MS) log.warn(fields, `${op} end (degraded)`);
      else log.debug(fields, `${op} end`);
      return res;
    } catch (err) {
      log.error(
        { op, httpMethod: init.method, path, elapsedMs: Math.round(performance.now() - start), err },
        `${op} failed`,
      );
      throw err;
    }
  };
}
