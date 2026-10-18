import request from 'supertest';
import { createApp } from '../src/app';
import { renderTemplate } from '../src/templates';

const SECRET = 'internal-secret-123';

function makeApp(overrides: { send?: jest.Mock; authSecret?: string | undefined } = {}) {
  const send = overrides.send ?? jest.fn().mockResolvedValue({ messageId: 'm-1' });
  const app = createApp({
    provider: { send },
    from: 'noreply@fuzefront.com',
    authSecret: 'authSecret' in overrides ? overrides.authSecret : SECRET,
  });
  return { app, send };
}

describe('POST /send (internal)', () => {
  const body = { to: 'user@example.com', template: 'password-reset', data: { token: 'abc123' } };

  it('rejects a request with no bearer (401) and sends nothing', async () => {
    const { app, send } = makeApp();
    const res = await request(app).post('/send').send(body);
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a wrong bearer (401)', async () => {
    const { app, send } = makeApp();
    const res = await request(app).post('/send').set('Authorization', 'Bearer nope').send(body);
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed (401) when no secret is configured, even with a bearer', async () => {
    const { app, send } = makeApp({ authSecret: '' });
    const res = await request(app).post('/send').set('Authorization', 'Bearer ').send(body);
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the password-reset template with the reset link (202)', async () => {
    const { app, send } = makeApp();
    const res = await request(app).post('/send').set('Authorization', `Bearer ${SECRET}`).send(body);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, messageId: 'm-1' });
    const msg = send.mock.calls[0][0];
    expect(msg.to).toBe('user@example.com');
    expect(msg.from).toBe('noreply@fuzefront.com');
    expect(msg.text).toContain('/reset?token=abc123');
  });

  it('sends the verify-email template with link and code', async () => {
    const { app, send } = makeApp();
    const res = await request(app)
      .post('/send')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ to: 'user@example.com', template: 'verify-email', data: { token: 'tok9', code: '123456' } });
    expect(res.status).toBe(202);
    const msg = send.mock.calls[0][0];
    expect(msg.text).toContain('/verify/email?token=tok9');
    expect(msg.html).toContain('123456');
    expect(msg.text).toContain('123456');
  });

  it('400s on an unknown template, bad recipient, or extra fields', async () => {
    const { app, send } = makeApp();
    const auth = `Bearer ${SECRET}`;
    for (const bad of [
      { ...body, template: 'nope' },
      { ...body, to: 'not-an-email' },
      { ...body, extra: 1 },
    ]) {
      const res = await request(app).post('/send').set('Authorization', auth).send(bad);
      expect(res.status).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('502s with a stable code on provider failure and logs neither token nor raw message', async () => {
    const send = jest.fn().mockRejectedValue(new Error('ETIMEDOUT contacting smtp for user@example.com'));
    const { app } = makeApp({ send });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await request(app).post('/send').set('Authorization', `Bearer ${SECRET}`).send(body);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'delivery failed', code: 'provider_timeout' });
    const logged = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toContain('FAILED: provider_timeout');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('user@example.com');
    errSpy.mockRestore();
  });

  it('503s when no provider is wired', async () => {
    const app = createApp({ authSecret: SECRET });
    const res = await request(app).post('/send').set('Authorization', `Bearer ${SECRET}`).send(body);
    expect(res.status).toBe(503);
  });
});

describe('verify-email / password-reset templates', () => {
  it('escapes the code and URL-encodes the token', () => {
    const r = renderTemplate('verify-email', { token: 'a b&c', code: '<b>1</b>' });
    expect(r.html).not.toContain('<b>1</b>');
    expect(r.text).toContain('token=a%20b%26c');
  });

  it('prefers the tenant origin from the payload, re-validated; bad values fall back to APP_BASE_URL', () => {
    expect(renderTemplate('password-reset', { token: 't', appBaseUrl: 'https://acme.example.com' }).text).toContain(
      'https://acme.example.com/reset?token=t',
    );
    expect(renderTemplate('verify-email', { token: 't', appBaseUrl: 'javascript:alert(1)' }).text).toContain(
      'https://app.fuzefront.com/verify/email?token=t',
    );
    expect(renderTemplate('password-reset', { token: 't', appBaseUrl: 42 }).text).toContain('https://app.fuzefront.com/reset');
  });

  it('honours APP_BASE_URL', () => {
    process.env.APP_BASE_URL = 'https://stage.example.com/';
    try {
      expect(renderTemplate('password-reset', { token: 't' }).text).toContain(
        'https://stage.example.com/reset?token=t',
      );
    } finally {
      delete process.env.APP_BASE_URL;
    }
  });
});
