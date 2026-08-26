import request from 'supertest';
import { createApp } from '../src/app';
import { setFlagClient } from '../src/flags';
import { bearer, TEST_JWT_SECRET } from './helpers/authToken';

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterEach(() => {
  setFlagClient(null);
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('config-service');
  });

  // FFRNT-255 / FF-EPIC-17-S8: `configManagementEnabled` reflects this
  // service's own evaluation of the release flag, default OFF, and never
  // changes /health's status code (the flag gates consumers reading FROM
  // config-service, not the service's own existence).
  it('reports configManagementEnabled: false when the flag is OFF (default, no client wired)', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.configManagementEnabled).toBe(false);
  });

  it('reports configManagementEnabled: true when the flag resolves ON', async () => {
    setFlagClient({ getBooleanValue: jest.fn().mockResolvedValue(true) });
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok'); // service existence unaffected by the flag
    expect(res.body.configManagementEnabled).toBe(true);
  });

  it('stays healthy (fails closed to OFF, not to an error) when the flag client throws', async () => {
    setFlagClient({ getBooleanValue: jest.fn().mockRejectedValue(new Error('Unleash unreachable')) });
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.configManagementEnabled).toBe(false);
  });
});

describe('GET /docs — mounted regardless of deps (no DB required)', () => {
  it('401s with no credential', async () => {
    const app = createApp();
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(401);
  });

  it('200s for an authenticated developer', async () => {
    const app = createApp();
    const res = await request(app).get('/docs/').set('Authorization', bearer({ userId: 'dev-1' }));
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
