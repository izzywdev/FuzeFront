import request from 'supertest';
import { createApp } from '../src/app';
import { createMockTwilioClient } from '../src/twilio-client';
import { RateLimiter } from '../src/rate-limiter';

const app = createApp({
  authSecret: 'test-secret',
  twilioClient: createMockTwilioClient(),
  verifyServiceSid: 'VA_TEST',
  rateLimiter: new RateLimiter({ cooldownMs: 0, maxPerHour: 100 }),
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('sms-service');
  });
});
