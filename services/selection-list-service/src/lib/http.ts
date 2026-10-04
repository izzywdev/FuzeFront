// lib/http.ts — failure-containment primitives for the Express layer.
//
// WHY THIS EXISTS (docs/security/selection-lists-authz-review-2026-10.md, H-4).
// Express 4 does not forward a rejected promise from an async handler to
// `next()`. A handler that awaits a DB call outside its own try/catch therefore
// leaves an unhandled rejection, and on Node >= 15 that terminates the process.
// With `replicas: 1`, one request that makes Postgres error (e.g. a NUL byte in
// a text parameter, SQLSTATE 22021) took the whole service down.
//
// Three layers, outermost last:
//   1. `createRouter()` — a Router whose every handler/middleware is wrapped so a
//      rejection (or sync throw) is forwarded to `next(err)`. Structural: a new
//      route cannot forget it, which a per-handler `asyncHandler(...)` could.
//   2. `errorHandler`   — the terminal Express error handler: contract error body
//      `{ code, message }`, never a stack trace, never a hung socket.
//   3. process-level policy (see `installProcessHandlers`) — the backstop for
//      anything that escapes the request path entirely (timers, Kafka callbacks).

import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getLog, logger } from './logger';

/**
 * Wrap a (possibly async) handler so that a rejected promise or a synchronous
 * throw reaches Express's error pipeline instead of the process.
 * Error-handling middleware (arity 4) is returned untouched.
 */
export function asyncHandler<H extends (...args: any[]) => unknown>(fn: H): RequestHandler {
  if (fn.length === 4) return fn as unknown as RequestHandler;
  return function wrapped(req: Request, res: Response, next: NextFunction): void {
    try {
      const out = fn(req, res, next);
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        (out as Promise<unknown>).then(undefined, next);
      }
    } catch (err) {
      next(err);
    }
  };
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'all'] as const;

function wrapAll(handlers: unknown[]): unknown[] {
  return handlers.map((h) =>
    Array.isArray(h) ? wrapAll(h) : typeof h === 'function' ? asyncHandler(h as never) : h,
  );
}

/**
 * `express.Router()` whose route handlers are all `asyncHandler`-wrapped. Use
 * this instead of `Router()` for every router in the service.
 */
export function createRouter(): Router {
  const router = Router();
  for (const verb of VERBS) {
    const original = (router as any)[verb].bind(router);
    (router as any)[verb] = (path: unknown, ...handlers: unknown[]) =>
      original(path, ...wrapAll(handlers));
  }
  return router;
}

interface HttpishError {
  status?: number;
  statusCode?: number;
  type?: string;
}

/**
 * Terminal error handler. Anything forwarded via `next(err)` — including a
 * rejected async handler caught by `asyncHandler` — ends here.
 *
 *  - body-parser failures (malformed JSON, oversized body) are the CLIENT's
 *    fault: 400 VALIDATION_ERROR / 413, not a 500 and not an error-level log.
 *  - everything else is a 500 `INTERNAL_ERROR`, logged at ERROR with the
 *    request context. The response never carries the error message or stack.
 *
 * `INTERNAL_ERROR` matches the code every route handler in this service already
 * returns for a caught failure (the frozen ErrorCode enum has no 5xx member).
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    // Too late to write a body; let Express close the connection.
    next(err);
    return;
  }
  const e = (err ?? {}) as HttpishError;
  const status = e.status ?? e.statusCode;

  if (e.type === 'entity.parse.failed') {
    getLog(req).info('request body is not valid JSON — 400');
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON.' });
    return;
  }
  if (e.type === 'entity.too.large' || status === 413) {
    getLog(req).info('request body too large — 413');
    res.status(413).json({ code: 'VALIDATION_ERROR', message: 'Request body is too large.' });
    return;
  }
  if (status !== undefined && status >= 400 && status < 500) {
    getLog(req).info({ status }, 'client error forwarded to error handler');
    res.status(status).json({ code: 'VALIDATION_ERROR', message: 'Bad request.' });
    return;
  }

  getLog(req).error(
    { err, userId: req.userId, orgId: req.orgId, method: req.method, route: req.path },
    'unhandled route error — 500',
  );
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
}

// ---------------------------------------------------------------------------
// Process-level policy
// ---------------------------------------------------------------------------

export interface ProcessPolicyDeps {
  /** Begin graceful shutdown (stop accepting, drain, close pools, exit). */
  shutdown: (reason: string, exitCode: number) => void | Promise<void>;
  /** Defaults to the root process. Injectable for tests. */
  proc?: Pick<NodeJS.Process, 'on' | 'off'>;
}

/**
 * Process-level backstop. Policy, deliberately split by event:
 *
 *  - `unhandledRejection`: LOG at ERROR and KEEP SERVING. The request path is
 *    already contained by `createRouter()` + `errorHandler`, so a rejection that
 *    still gets here belongs to a background task (a Kafka callback, a timer),
 *    not to a request. It must never be silent, and one bad background promise
 *    must not take down a replica that is serving other tenants' traffic. The
 *    log line is the alarm.
 *  - `uncaughtException`: the process is in an unknown state — log FATAL and
 *    shut down gracefully with a non-zero exit so the kubelet restarts a clean
 *    process. Continuing after an uncaught exception is how state corrupts.
 *
 * Returns an `uninstall()` for tests.
 */
export function installProcessHandlers({ shutdown, proc = process }: ProcessPolicyDeps): () => void {
  const onRejection = (reason: unknown): void => {
    logger.error(
      { err: reason, op: 'process.unhandledRejection' },
      'unhandled promise rejection outside the request path — logged, process kept alive',
    );
  };
  const onException = (err: unknown): void => {
    logger.fatal(
      { err, op: 'process.uncaughtException' },
      'uncaught exception — shutting down gracefully',
    );
    void shutdown('uncaughtException', 1);
  };
  proc.on('unhandledRejection', onRejection);
  proc.on('uncaughtException', onException);
  return () => {
    proc.off('unhandledRejection', onRejection);
    proc.off('uncaughtException', onException);
  };
}
