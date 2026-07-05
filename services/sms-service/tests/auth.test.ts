import request from 'supertest';
import { createApp } from '../src/app';
import { createMockTwilioClient } from '../src/twilio-client';
import { RateLimiter } from '../src/rate-limiter';

const app = createApp({
  authSecret: 'super-secret',
  twilioClient: createMockTwilioClient(),
  verifyServiceSid: 'VA_TEST',
  rateLimiter: new RateLimiter({ cooldownMs: 0, maxPerHour: 100 }),
});

describe('Auth middleware', () => {
  it('rejects requests with no Authorization header', async () => {
    const res = await request(app).post('/sms/send').send({ to: '+15551234567' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret', async () => {
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer wrong-secret')
      .send({ to: '+15551234567' });
    expect(res.status).toBe(401);
  });

  it('rejects a token that is a prefix of the real secret (length guard)', async () => {
    // timingSafeEqual with mismatched lengths must return 401, not throw
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer super-secre') // one char short
      .send({ to: '+15551234567' });
    expect(res.status).toBe(401);
  });

  it('rejects a token that is longer than the real secret (length guard)', async () => {
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer super-secret-extra')
      .send({ to: '+15551234567' });
    expect(res.status).toBe(401);
  });

  it('accepts requests with correct secret', async () => {
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer super-secret')
      .send({ to: '+15551234567' });
    // Will be 200 (mock client) not 401
    expect(res.status).not.toBe(401);
  });

  it('allows /health without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
