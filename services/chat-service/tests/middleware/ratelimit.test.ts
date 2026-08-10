// ratelimit.test.ts — hermetic rate-limit test using the in-memory store.
//
// Strategy: pass null for the Redis client so the factory falls back to the
// express-rate-limit default MemoryStore. We then drive 21 requests through a
// tiny express app and assert the 21st gets 429.

import request from 'supertest';
import express, { Request, Response } from 'express';
import { createChatStreamLimiter, createConfirmLimiter, createGlobalLimiter } from '../../src/middleware/ratelimit';

function makeStreamApp() {
  const app = express();
  // Pass null explicitly so the factory uses the in-memory store (no Redis needed).
  const limiter = createChatStreamLimiter(null);
  app.get('/stream', limiter, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

describe('createChatStreamLimiter (20 req/min)', () => {
  it('allows the first 20 requests and blocks the 21st with 429', async () => {
    const app = makeStreamApp();

    // First 20 should pass
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get('/stream');
      expect(res.status).toBe(200);
    }

    // 21st must be rate-limited
    const blocked = await request(app).get('/stream');
    expect(blocked.status).toBe(429);
  }, 30000);
});

describe('createConfirmLimiter exports a rate-limiter factory', () => {
  it('constructs without throwing (null Redis)', () => {
    expect(() => createConfirmLimiter(null)).not.toThrow();
  });
});

describe('createGlobalLimiter exports a rate-limiter factory', () => {
  it('constructs without throwing (null Redis)', () => {
    expect(() => createGlobalLimiter(null)).not.toThrow();
  });
});

// Regression for FuzeFront #510: the DEFAULT (no-arg) factory path must never
// crash the process — neither when REDIS_URL is unset (prod) nor when it points
// at an unreachable host. Before the fix, the no-arg path defaulted to
// redis://localhost:6379 and built the client with enableOfflineQueue:false, so
// rate-limit-redis's constructor-time SCRIPT LOAD rejected into an unhandled
// rejection and took the pod down (chat-service CrashLoopBackOff in prod).
//
// These cases exercise the module-level getDefaultRedisClient(), so each uses
// jest.isolateModules() with resetModules to defeat its one-shot memoization.
describe('default limiter factory does not crash the process (FuzeFront #510)', () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(() => {
    if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    jest.resetModules();
  });

  it('uses the in-memory store (no Redis client) when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../../src/middleware/ratelimit');
      expect(() => mod.createGlobalLimiter()).not.toThrow();
    });
  });

  it('does not throw or emit an unhandled rejection when REDIS_URL is unreachable', async () => {
    // Port 1 is reserved/closed — the client can never connect.
    process.env.REDIS_URL = 'redis://127.0.0.1:1';

    const rejections: unknown[] = [];
    const onUnhandled = (err: unknown) => rejections.push(err);
    process.on('unhandledRejection', onUnhandled);

    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../../src/middleware/ratelimit');
        // Constructing the store fires rate-limit-redis's eager SCRIPT LOAD.
        expect(() => mod.createGlobalLimiter()).not.toThrow();
      });

      // Give any floating promise from the constructor a few ticks to settle.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(rejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 10000);
});
