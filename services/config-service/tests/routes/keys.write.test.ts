import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import { configureIdentity } from '@izzywdev/fuzefront-identity';
import { createKeyDefinitionsWriteRouter } from '../../src/routes/keys.write';
import { FakeDb } from '../helpers/fakeDb';
import { bearer, TEST_JWT_SECRET } from '../helpers/authToken';
import { _setPermitClientForTesting, makeNoOpProxy } from '../../src/middleware/permit';

beforeAll(() => {
  configureIdentity({ legacyUuidTypes: new Set(['portal', 'organization', 'user']) });
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});
afterEach(() => {
  _setPermitClientForTesting(makeNoOpProxy());
});

function buildApp(db: FakeDb) {
  const app = express();
  app.use(express.json());
  app.use(createKeyDefinitionsWriteRouter(db.pool));
  return app;
}

const NAMESPACE_ID = randomUUID();
const NAMESPACE = 'fuzefront.chat';

function seedNamespace(db: FakeDb) {
  db.seedNamespace({ id: NAMESPACE_ID, namespace: NAMESPACE });
}

describe('PUT /v1/namespaces/{namespace}/keys', () => {
  it('401s with no credential', async () => {
    const db = new FakeDb();
    seedNamespace(db);
    const app = buildApp(db);
    const res = await request(app).put(`/v1/namespaces/${NAMESPACE}/keys`).send({ keys: [] });
    expect(res.status).toBe(401);
  });

  it('404s for an unknown namespace', async () => {
    const db = new FakeDb();
    const app = buildApp(db);
    const res = await request(app)
      .put('/v1/namespaces/no.such.namespace/keys')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ keys: [] });
    expect(res.status).toBe(404);
  });

  it('creates new keys and reports them under `created`', async () => {
    const db = new FakeDb();
    seedNamespace(db);
    const app = buildApp(db);

    const res = await request(app)
      .put(`/v1/namespaces/${NAMESPACE}/keys`)
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({
        keys: [
          { key: 'ui.theme.density', displayName: 'Density', valueType: 'string', defaultValue: 'comfortable', allowedScopes: ['user'] },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toEqual(['ui.theme.density']);
    expect(db.keyDefRows).toHaveLength(1);
    expect(db.keyDefRows[0].key).toBe('ui.theme.density');
  });

  it('is idempotent: re-registering an unchanged manifest reports `unchanged`, no writes', async () => {
    const db = new FakeDb();
    seedNamespace(db);
    const app = buildApp(db);
    const manifest = {
      keys: [{ key: 'ui.theme.density', displayName: 'Density', valueType: 'string', defaultValue: 'comfortable', allowedScopes: ['user'] }],
    };

    await request(app).put(`/v1/namespaces/${NAMESPACE}/keys`).set('Authorization', bearer({ userId: 'u1' })).send(manifest);
    const res = await request(app).put(`/v1/namespaces/${NAMESPACE}/keys`).set('Authorization', bearer({ userId: 'u1' })).send(manifest);

    expect(res.status).toBe(200);
    expect(res.body.unchanged).toEqual(['ui.theme.density']);
    expect(res.body.created).toEqual([]);
    expect(res.body.updated).toEqual([]);
    expect(db.keyDefRows).toHaveLength(1);
  });

  it('deprecates (never deletes) a key omitted from a `complete` manifest', async () => {
    const db = new FakeDb();
    seedNamespace(db);
    const app = buildApp(db);
    const auth = bearer({ userId: 'u1' });

    await request(app)
      .put(`/v1/namespaces/${NAMESPACE}/keys`)
      .set('Authorization', auth)
      .send({
        complete: true,
        keys: [
          { key: 'ui.theme.density', displayName: 'Density', valueType: 'string', defaultValue: 'comfortable', allowedScopes: ['user'] },
          { key: 'ui.legacy', displayName: 'Legacy', valueType: 'string', defaultValue: 'x', allowedScopes: ['user'] },
        ],
      });

    const res = await request(app)
      .put(`/v1/namespaces/${NAMESPACE}/keys`)
      .set('Authorization', auth)
      .send({
        complete: true,
        keys: [{ key: 'ui.theme.density', displayName: 'Density', valueType: 'string', defaultValue: 'comfortable', allowedScopes: ['user'] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.deprecated).toEqual(['ui.legacy']);
    expect(db.keyDefRows).toHaveLength(2); // never deleted
    expect(db.keyDefRows.find((d) => d.key === 'ui.legacy')?.deprecated_at).not.toBeNull();
  });

  it('409s (INCOMPATIBLE_DEFINITION) and writes NOTHING when a shape change would strand a stored value', async () => {
    const db = new FakeDb();
    seedNamespace(db);
    const app = buildApp(db);
    const auth = bearer({ userId: 'u1' });

    await request(app)
      .put(`/v1/namespaces/${NAMESPACE}/keys`)
      .set('Authorization', auth)
      .send({
        keys: [
          { key: 'ui.mode', displayName: 'Mode', valueType: 'enum', enumValues: ['light', 'dark'], defaultValue: 'light', allowedScopes: ['user'] },
        ],
      });
    const definitionId = db.keyDefRows[0].id;
    db.seedValue({ definition_id: definitionId, scope_type: 'org', scope_id: randomUUID(), value: 'dark' });

    const res = await request(app)
      .put(`/v1/namespaces/${NAMESPACE}/keys`)
      .set('Authorization', auth)
      .send({
        // Also declares a brand-new, otherwise-fine key — proving the WHOLE
        // batch is refused, not just the incompatible one.
        keys: [
          { key: 'ui.mode', displayName: 'Mode', valueType: 'enum', enumValues: ['light'], defaultValue: 'light', allowedScopes: ['user'] },
          { key: 'ui.other', displayName: 'Other', valueType: 'string', defaultValue: 'x', allowedScopes: ['user'] },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INCOMPATIBLE_DEFINITION');
    expect(res.body.details).toEqual([expect.objectContaining({ key: 'ui.mode' })]);
    // Nothing changed: still exactly the one key definition from before, unchanged metadata.
    expect(db.keyDefRows).toHaveLength(1);
    expect(db.keyDefRows[0].enum_values).toEqual(['light', 'dark']);
  });

  it('403s when Permit denies key registration for this namespace', async () => {
    _setPermitClientForTesting({ check: async () => false });
    const db = new FakeDb();
    seedNamespace(db);
    const app = buildApp(db);

    const res = await request(app)
      .put(`/v1/namespaces/${NAMESPACE}/keys`)
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ keys: [{ key: 'ui.theme.density', displayName: 'Density', valueType: 'string', defaultValue: 'x', allowedScopes: ['user'] }] });

    expect(res.status).toBe(403);
    expect(db.keyDefRows).toHaveLength(0);
  });

  it('400s a manifest declaring the same key twice', async () => {
    const db = new FakeDb();
    seedNamespace(db);
    const app = buildApp(db);

    const res = await request(app)
      .put(`/v1/namespaces/${NAMESPACE}/keys`)
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({
        keys: [
          { key: 'ui.theme.density', displayName: 'A', valueType: 'string', defaultValue: 'x', allowedScopes: ['user'] },
          { key: 'ui.theme.density', displayName: 'B', valueType: 'string', defaultValue: 'y', allowedScopes: ['user'] },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400s a key input carrying a client-supplied id', async () => {
    const db = new FakeDb();
    seedNamespace(db);
    const app = buildApp(db);

    const res = await request(app)
      .put(`/v1/namespaces/${NAMESPACE}/keys`)
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({
        keys: [{ id: 'ckd_attacker', key: 'ui.theme.density', displayName: 'A', valueType: 'string', defaultValue: 'x', allowedScopes: ['user'] }],
      });

    expect(res.status).toBe(400);
  });
});
