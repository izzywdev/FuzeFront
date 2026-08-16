// health.test.ts — smoke test: GET /health returns 200 with status ok.
//
// This test does NOT require a database connection — the health route is
// stateless and unauthenticated by design (used by k8s liveness/readiness probes).

import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns 200 with status ok (unauthenticated)', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('selection-list-service');
  });
});
