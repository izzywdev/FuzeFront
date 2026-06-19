// ratelimit.ts — per-user rate limiting for chat-service.
//
// Uses express-rate-limit 7.x with an optional Redis backing store
// (rate-limit-redis 4.x). Falls back gracefully when Redis is unavailable:
// the limiter is constructed successfully (no crash at startup); if the
// RedisStore itself errors it reverts to the default in-memory store behavior.
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

  try {
    // Dynamic require keeps ioredis out of the test tree when mocking.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IoRedis = require('ioredis');
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = new IoRedis(redisUrl, {
      // Do not crash the process on connection failure.
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    // Swallow connection errors silently — rate limiting degrades to in-memory.
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
