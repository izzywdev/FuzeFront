import request from 'supertest';
import { createApp } from '../src/app';
import { createMockTwilioClient, TwilioVerifyClient } from '../src/twilio-client';
import { RateLimiter } from '../src/rate-limiter';

function makeApp(client: TwilioVerifyClient) {
  return createApp({
    authSecret: 'secret',
    twilioClient: client,
    verifyServiceSid: 'VA_TEST',
    rateLimiter: new RateLimiter({ cooldownMs: 0, maxPerHour: 100 }),
  });
}

describe('POST /sms/verify', () => {
  it('returns 200 with verified:true when code is approved', async () => {
    // Mock client returns approved for code "000000"
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: '000000' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('returns 200 with verified:false when code is pending (wrong code)', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: '999999' });
    // Must NOT throw — pending maps to verified:false
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });

  it('calls verificationChecks.create with the correct phone and code', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ status: 'approved' });
    const client: TwilioVerifyClient = {
      verify: {
        v2: {
          services: (_sid: string) => ({
            verifications: { create: jest.fn() },
            verificationChecks: { create: mockCreate },
          }),
        },
      },
    };
    const app = makeApp(client);
    await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: '123456' });
    expect(mockCreate).toHaveBeenCalledWith({ to: '+15551234567', code: '123456' });
  });

  it('returns 400 for non-E.164 phone', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: 'not-a-phone', code: '123456' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing code', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric code', async () => {
    const app = makeApp(createMockTwilioClient());
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: 'abcdef' });
    expect(res.status).toBe(400);
  });

  it('does not throw when Twilio returns an unexpected status', async () => {
    const client: TwilioVerifyClient = {
      verify: {
        v2: {
          services: (_sid: string) => ({
            verifications: { create: jest.fn() },
            verificationChecks: {
              create: jest.fn().mockResolvedValue({ status: 'canceled' }),
            },
          }),
        },
      },
    };
    const app = makeApp(client);
    const res = await request(app)
      .post('/sms/verify')
      .set('Authorization', 'Bearer secret')
      .send({ to: '+15551234567', code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });
});
