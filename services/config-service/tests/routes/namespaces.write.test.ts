import express from 'express';
import request from 'supertest';
import { createNamespacesWriteRouter } from '../../src/routes/namespaces.write';
import { FakeDb } from '../helpers/fakeDb';
import { bearer, TEST_JWT_SECRET } from '../helpers/authToken';
import { _setPermitClientForTesting, makeNoOpProxy } from '../../src/middleware/permit';

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});
afterEach(() => {
  _setPermitClientForTesting(makeNoOpProxy());
});

function buildApp(db: FakeDb) {
  const app = express();
  app.use(express.json());
  app.use(createNamespacesWriteRouter(db.pool));
  return app;
}

describe('POST /v1/namespaces', () => {
  it('401s with no credential', async () => {
    const db = new FakeDb();
    const app = buildApp(db);
    const res = await request(app).post('/v1/namespaces').send({ namespace: 'fuzefront.chat', displayName: 'Chat' });
    expect(res.status).toBe(401);
  });

  it('201s and mints an id for a brand-new namespace', async () => {
    const db = new FakeDb();
    const app = buildApp(db);
    const res = await request(app)
      .post('/v1/namespaces')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: 'fuzefront.chat', displayName: 'Chat' });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^cns_/);
    expect(res.body.namespace).toBe('fuzefront.chat');
  });

  it('is idempotent: re-registering an existing namespace returns 200 and updates metadata', async () => {
    const db = new FakeDb();
    const app = buildApp(db);
    const first = await request(app)
      .post('/v1/namespaces')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: 'fuzefront.chat', displayName: 'Chat' });

    const second = await request(app)
      .post('/v1/namespaces')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: 'fuzefront.chat', displayName: 'Chat (renamed)' });

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.displayName).toBe('Chat (renamed)');
  });

  it('400s a body carrying a client-supplied id — the service mints ids, never accepts one', async () => {
    const db = new FakeDb();
    const app = buildApp(db);
    const res = await request(app)
      .post('/v1/namespaces')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ id: 'cns_attacker-supplied', namespace: 'fuzefront.chat', displayName: 'Chat' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400s a malformed namespace name', async () => {
    const db = new FakeDb();
    const app = buildApp(db);
    const res = await request(app)
      .post('/v1/namespaces')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: 'Not Valid!', displayName: 'x' });

    expect(res.status).toBe(400);
  });

  it('403s when Permit denies namespace registration', async () => {
    _setPermitClientForTesting({ check: async () => false });
    const db = new FakeDb();
    const app = buildApp(db);
    const res = await request(app)
      .post('/v1/namespaces')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: 'fuzefront.chat', displayName: 'Chat' });

    expect(res.status).toBe(403);
  });
});
