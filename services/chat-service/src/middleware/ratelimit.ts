// ratelimit.ts — per-user rate limiting for chat-service.
//
// Uses express-rate-limit 7.x with an optional Redis backing store
// (rate-limit-redis 4.x). Falls back gracefully when Redis is unavailable:
// the limiter is constructed successfully (no crash at startup) and rate
// limiting degrades to the in-memory store.
//
// Redis is OPT-IN via the REDIS_URL environment variable. When REDIS_URL is
// unset (as in prod — see deploy/helm/fuzefront/templates/chat-service.yaml,
// which deliberately does not mount it) NO Redis client is created and the
// limiter uses express-rate-limit's default MemoryStore. Rate limiting is then
// per-pod, which the current low replica count makes acceptable. Wiring a
// shared Redis (for cross-replica limits) is a separate enhancement.
//
// Two crash modes this file must never fall into again — both took the pod
// down in prod (fuzefront-chat-service CrashLoopBackOff, FuzeFront #510):
//   1. Defaulting to redis://localhost:6379 when REDIS_URL is unset: nothing
//      serves that address in the pod, so every command fails.
//   2. Constructing the client with `enableOfflineQueue: false`:
//      rate-limit-redis runs a `SCRIPT LOAD` inside `new RedisStore()`, BEFORE
//      this client has connected. With the offline queue disabled that command
//      rejects immediately; rate-limit-redis never awaits the promise, so the
//      rejection is unhandled and Node terminates the process. A try/catch
//      around `new RedisStore()` cannot catch an async rejection.
//
// Key generator: req.userId (set by auth middleware) with IP as fallback.
// This means unauthenticated requests (hitting routes before auth runs, e.g.
// health check) are IP-keyed.
//
// Three factory exports per §10f:
//   createChatStreamLimiter()  — 20 req/min  (the expensive SSE stream endpoint)
//   createConfirmLimiter()     — 60 req/min  (tool confirmation ACKs)
//   createGlobalLimiter()      — 100 req/min (all authenticated chat routes)
//
// The Redis client can be injected for testability. If not injected, the factory
// reads REDIS_URL from the environment and creates an ioredis client lazily.

import rateLimit, { Options as RateLimitOptions, RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore, SendCommandFn } from 'rate-limit-redis';
import type { Request } from 'express';

// We import ioredis lazily so tests can mock without a real connection.
type RedisClient = {
  sendCommand: SendCommandFn;
} | null;

function keyGenerator(req: Request): string {
  return (req as any).userId ?? req.ip ?? 'anonymous';
}

function buildOptions(
  windowMs: number,
  max: number,
  redisClient: RedisClient,
): Partial<RateLimitOptions> {
  const base: Partial<RateLimitOptions> = {
    windowMs,
    max,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  };

  if (redisClient) {
    try {
      base.store = new RedisStore({
        // rate-limit-redis 4.x requires a sendCommand function
        sendCommand: redisClient.sendCommand,
      });
    } catch {
      // If RedisStore construction fails (e.g., wrong client shape in tests),
      // fall back to in-memory. The service continues running.
    }
  }

  return base;
}

// Lazily resolved default Redis client (created at first use, not at module load).
let _defaultRedisClient: RedisClient = null;
let _defaultRedisAttempted = false;

function getDefaultRedisClient(): RedisClient {
  if (_defaultRedisAttempted) return _defaultRedisClient;
  _defaultRedisAttempted = true;

  // Redis is opt-in. Without an explicit REDIS_URL we use the in-memory store —
  // NEVER a localhost default, which has nothing behind it in the pod and turns
  // every rate-limit command into a failure (crash mode #1 above).
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    _defaultRedisClient = null;
    return _defaultRedisClient;
  }

  try {
    // Dynamic require keeps ioredis out of the test tree when mocking.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IoRedis = require('ioredis');
    const client = new IoRedis(redisUrl, {
      // enableOfflineQueue MUST stay true (crash mode #2 above): the SCRIPT LOAD
      // that rate-limit-redis fires inside `new RedisStore()` happens before the
      // socket is up. Queuing it until the connection is ready keeps startup
      // crash-free; disabling the queue rejects it into an unhandled rejection
      // that kills the process. ioredis's default retryStrategy reconnects
      // indefinitely, so a transient outage never rejects a queued command.
      enableOfflineQueue: true,
    });
    // Swallow connection errors silently — rate limiting degrades to in-memory
    // behavior rather than crashing the process.
    client.on('error', () => {/* intentionally silent */});
    _defaultRedisClient = {
      sendCommand: (...args: string[]) =>
        client.call(...(args as [string, ...string[]])) as Promise<import('rate-limit-redis').RedisReply>,
    };
  } catch {
    // ioredis not installed or failed to init — use in-memory fallback.
    _defaultRedisClient = null;
  }

  return _defaultRedisClient;
}

/** 20 requests per minute — for POST /chat/stream (the expensive SSE endpoint). */
export function createChatStreamLimiter(
  redisClient: RedisClient = getDefaultRedisClient(),
): RateLimitRequestHandler {
  return rateLimit(buildOptions(60_000, 20, redisClient) as RateLimitOptions);
}

/** 60 requests per minute — for POST /chat/confirm/:id (tool confirmation ACKs). */
export function createConfirmLimiter(
  redisClient: RedisClient = getDefaultRedisClient(),
): RateLimitRequestHandler {
  return rateLimit(buildOptions(60_000, 60, redisClient) as RateLimitOptions);
}

/** 100 requests per minute — global limiter applied to all authenticated chat routes. */
export function createGlobalLimiter(
  redisClient: RedisClient = getDefaultRedisClient(),
): RateLimitRequestHandler {
  return rateLimit(buildOptions(60_000, 100, redisClient) as RateLimitOptions);
}
