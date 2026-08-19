import request from 'supertest';
import { createApp } from '../src/app';
import { createMockTwilioClient, TwilioVerifyClient } from '../src/twilio-client';
import { RateLimiter } from '../src/rate-limiter';

function makeApp(client: TwilioVerifyClient, rateLimiter?: RateLimiter) {
  return createApp({
    authSecret: 'secret',
    twilioClient: client,
    verifyServiceSid: 'VA_TEST',
    rateLimiter: rateLimiter ?? new RateLimiter({ cooldownMs: 0, maxPerHour: 100 }),
  });
}

describe('POST /sms/send', () => {
  it('returns 200 for a valid E.164 phone', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('calls verifications.create with the correct phone and channel', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ status: 'pending' });
    const client: TwilioVerifyClient = {
      verify: {
        v2: {
          services: (_sid: string) => ({
            verifications: { create: mockCreate },
            verificationChecks: { create: jest.fn() },
          }),
        },
      },
    };
    const app = makeApp(client);
    await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567' });
    expect(mockCreate).toHaveBeenCalledWith({ to: '+15551234567', channel: 'sms' });
  });

  it('returns 400 for a non-E.164 phone number', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '5551234567' }); // missing +
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty body', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limiter blocks (same phone, same IP)', async () => {
    const rl = new RateLimiter({ cooldownMs: 3_600_000, maxPerHour: 10 });
    const app = makeApp(createMockTwilioClient(), rl);
    // First request passes
    await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15557654321' });
    // Second request within cooldown is blocked
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15557654321' });
    expect(res.status).toBe(429);
  });

  it('returns 429 when rate limiter blocks same phone even with a different IP (phone is the primary guard)', async () => {
    // Cooldown keyed on the phone alone — varying IP must NOT bypass it.
    const rl = new RateLimiter({ cooldownMs: 3_600_000, maxPerHour: 10 });
    const app = makeApp(createMockTwilioClient(), rl);
    // First request from IP "1.2.3.4" (simulated via X-Forwarded-For with trust proxy)
    await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .set('X-Forwarded-For', '1.2.3.4')
      .send({ to: '+15558888888' });
    // Second request spoofing a different IP — must still be blocked
    const res = await request(app)
      .post('/sms/send')
      .set('Authorization', 'Bearer secret')
      .set('X-Forwarded-For', '9.9.9.9')
      .send({ to: '+15558888888' });
    expect(res.status).toBe(429);
  });
});
