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
