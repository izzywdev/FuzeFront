import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import { configureIdentity } from '@izzywdev/fuzefront-identity';
import { createConfigWriteRouter } from '../../src/routes/config.write';
import { FakeDb } from '../helpers/fakeDb';
import { bearer, TEST_JWT_SECRET } from '../helpers/authToken';
import { _setPermitClientForTesting, makeNoOpProxy } from '../../src/auth/permit';

beforeAll(() => {
  configureIdentity({ legacyUuidTypes: new Set(['portal', 'organization', 'user']) });
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterEach(() => {
  // Restore the default CI no-op (allow-everything) Permit client between tests.
  _setPermitClientForTesting(makeNoOpProxy());
});

function buildApp(db: FakeDb) {
  const app = express();
  app.use(express.json());
  app.use(createConfigWriteRouter(db.pool));
  return app;
}

const NAMESPACE_ID = randomUUID();
const NAMESPACE = 'fuzefront.chat';
const KEY_DEF_ID = randomUUID();
const READONLY_DEF_ID = randomUUID();
const PLATFORM_ONLY_DEF_ID = randomUUID();
const SYSTEM_DEF_ID = randomUUID();

function seedBase(db: FakeDb) {
  db.seedNamespace({ id: NAMESPACE_ID, namespace: NAMESPACE });
  db.seedKeyDef({
    id: KEY_DEF_ID,
    namespace_id: NAMESPACE_ID,
    key: 'ui.theme.density',
    value_type: 'string',
    default_value: 'comfortable',
    allowed_scopes: ['platform', 'portal', 'org', 'user'],
  });
  db.seedKeyDef({
    id: READONLY_DEF_ID,
    namespace_id: NAMESPACE_ID,
    key: 'platform.version',
    value_type: 'string',
    default_value: '1.0.0',
    allowed_scopes: ['platform'],
    is_readonly: true,
  });
  db.seedKeyDef({
    id: PLATFORM_ONLY_DEF_ID,
    namespace_id: NAMESPACE_ID,
    key: 'platform.retention-days',
    value_type: 'number',
    default_value: 30,
    allowed_scopes: ['platform'],
  });
  db.seedKeyDef({
    id: SYSTEM_DEF_ID,
    namespace_id: NAMESPACE_ID,
    key: 'platform.maintenance-mode',
    value_type: 'boolean',
    default_value: false,
    allowed_scopes: ['platform'],
    is_system: true,
  });
}

const ORG_SCOPE = { scopeType: 'org', scopeId: randomUUID() };

describe('PUT /v1/config — auth', () => {
  it('401s with no credential', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'compact' }] });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('403s when Permit denies the write, and writes nothing', async () => {
    _setPermitClientForTesting({ check: async () => false });
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'compact' }] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(db.valueRows).toHaveLength(0);
  });
});

describe('PUT /v1/config — set', () => {
  it('applies a set and it is visible on a subsequent read', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'compact' }] });

    expect(res.status).toBe(200);
    expect(res.body.applied).toEqual(['ui.theme.density']);
    expect(db.valueRows).toHaveLength(1);
    expect(db.valueRows[0].value).toBe('compact');
    expect(db.valueRows[0].scope_type).toBe('org');
  });

  it('rejects a value that fails the key schema, VALIDATION_ERROR, nothing written', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 42 }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(db.valueRows).toHaveLength(0);
  });

  it('refuses a write at a scope the key excludes from allowedScopes (422 SCOPE_NOT_ALLOWED), nothing written', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({
        namespace: NAMESPACE,
        scope: ORG_SCOPE,
        operations: [{ key: 'platform.retention-days', op: 'set', value: 5 }], // allowedScopes: [platform] only
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SCOPE_NOT_ALLOWED');
    expect(db.valueRows).toHaveLength(0);
  });

  it('refuses to modify an isReadonly key at any scope (400), nothing written', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({
        namespace: NAMESPACE,
        scope: { scopeType: 'platform', scopeId: null },
        operations: [{ key: 'platform.version', op: 'set', value: '2.0.0' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(db.valueRows).toHaveLength(0);
  });

  it('requires write-system Permit action for isSystem keys, and denies without it', async () => {
    _setPermitClientForTesting({
      check: async (_user: string, action: string) => action !== 'write-system',
    });
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({
        namespace: NAMESPACE,
        scope: { scopeType: 'platform', scopeId: null },
        operations: [{ key: 'platform.maintenance-mode', op: 'set', value: true }],
      });

    expect(res.status).toBe(403);
    expect(db.valueRows).toHaveLength(0);
  });
});

describe('PUT /v1/config — unset is NOT "pin the parent value" (S6 highest-risk item)', () => {
  it('unset DELETES the override so it keeps tracking the parent; set-to-the-same-value PINS a row that stops tracking it', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);
    const auth = bearer({ userId: 'u1' });

    // Ancestor (platform) sets the value everyone should inherit.
    await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({
        namespace: NAMESPACE,
        scope: { scopeType: 'platform', scopeId: null },
        operations: [{ key: 'ui.theme.density', op: 'set', value: 'comfortable' }],
      });

    // The org pins its OWN copy of today's inherited value.
    const pinRes = await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'comfortable' }] });
    expect(pinRes.status).toBe(200);

    // Persisted state: TWO rows now exist — platform's and the org's pin —
    // even though their values are identical.
    const orgRowsAfterPin = db.valueRows.filter((r) => r.scope_type === 'org');
    expect(orgRowsAfterPin).toHaveLength(1);
    expect(db.valueRows).toHaveLength(2);

    // Now unset the org's override instead.
    const db2 = new FakeDb();
    seedBase(db2);
    const app2 = buildApp(db2);
    await request(app2)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({
        namespace: NAMESPACE,
        scope: { scopeType: 'platform', scopeId: null },
        operations: [{ key: 'ui.theme.density', op: 'set', value: 'comfortable' }],
      });
    await request(app2)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'compact' }] });
    const unsetRes = await request(app2)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'unset' }] });

    expect(unsetRes.status).toBe(200);
    // Persisted state after unset: the org's row is GONE (only platform's remains) —
    // the DISTINCT, provably-different outcome from the "pin" scenario above,
    // where the org row persisted.
    const orgRowsAfterUnset = db2.valueRows.filter((r) => r.scope_type === 'org');
    expect(orgRowsAfterUnset).toHaveLength(0);
    expect(db2.valueRows).toHaveLength(1);
  });
});

describe('PUT /v1/config — lock / unlock', () => {
  it('lock pins a value AND blocks a write from an org beneath a locked portal (409 LOCKED_BY_ANCESTOR)', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);
    const portalId = randomUUID();
    const auth = bearer({ userId: 'portal-admin', portalId });

    const lockRes = await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({
        namespace: NAMESPACE,
        scope: { scopeType: 'portal', scopeId: portalId },
        operations: [{ key: 'ui.theme.density', op: 'lock', value: 'comfortable', lockReason: 'policy' }],
      });
    expect(lockRes.status).toBe(200);
    expect(db.valueRows.find((r) => r.scope_type === 'portal')?.is_locked).toBe(true);

    // An org admin BENEATH that portal (same JWT-carried portalId) tries to write.
    const orgAuth = bearer({ userId: 'org-admin', portalId });
    const blockedRes = await request(app)
      .put('/v1/config')
      .set('Authorization', orgAuth)
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'compact' }] });

    expect(blockedRes.status).toBe(409);
    expect(blockedRes.body.code).toBe('LOCKED_BY_ANCESTOR');
    expect(blockedRes.body.lockedBy).toEqual({ scopeType: 'portal', scopeId: portalId });
    // Stored value at org scope is UNCHANGED (never existed) — the write was refused, not half-applied.
    expect(db.valueRows.filter((r) => r.scope_type === 'org')).toHaveLength(0);
  });

  it('unlock preserves the pinned value but clears is_locked', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);
    const auth = bearer({ userId: 'u1' });

    await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({
        namespace: NAMESPACE,
        scope: { scopeType: 'platform', scopeId: null },
        operations: [{ key: 'ui.theme.density', op: 'lock', value: 'compact', lockReason: 'policy' }],
      });

    const unlockRes = await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({ namespace: NAMESPACE, scope: { scopeType: 'platform', scopeId: null }, operations: [{ key: 'ui.theme.density', op: 'unlock' }] });

    expect(unlockRes.status).toBe(200);
    const row = db.valueRows.find((r) => r.scope_type === 'platform');
    expect(row?.is_locked).toBe(false);
    expect(row?.value).toBe('compact'); // value preserved, unlike unset
  });

  it('unlocking a scope with nothing set is a 400 VALIDATION_ERROR', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: NAMESPACE, scope: { scopeType: 'platform', scopeId: null }, operations: [{ key: 'ui.theme.density', op: 'unlock' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('PUT /v1/config — atomic batch (S6 AC3)', () => {
  it('a batch where one of several operations is invalid writes NOTHING at all', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({
        namespace: NAMESPACE,
        scope: ORG_SCOPE,
        operations: [
          { key: 'ui.theme.density', op: 'set', value: 'compact' }, // valid on its own
          { key: 'platform.retention-days', op: 'set', value: 5 }, // SCOPE_NOT_ALLOWED at org
        ],
      });

    expect(res.status).toBe(422);
    expect(db.valueRows).toHaveLength(0); // the otherwise-valid first op was NOT applied either
  });

  it('rejects an unknown key with nothing applied', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'no.such.key', op: 'set', value: 'x' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(db.valueRows).toHaveLength(0);
  });

  it('rejects a malformed body (missing operations) with 400', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('404s for an unknown namespace', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: 'no.such.namespace', scope: ORG_SCOPE, operations: [{ key: 'x', op: 'set', value: 1 }] });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('PUT /v1/config — optimistic concurrency (expectedVersion)', () => {
  it('409 VERSION_CONFLICT when the resolved view moved since expectedVersion, carrying currentVersion', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);
    const auth = bearer({ userId: 'u1' });

    const first = await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'compact' }] });
    const staleVersion = first.body.version;

    // A second writer changes the same scope, moving the version.
    await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'cozy' }] });

    const conflictRes = await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({
        namespace: NAMESPACE,
        scope: ORG_SCOPE,
        expectedVersion: staleVersion,
        operations: [{ key: 'ui.theme.density', op: 'set', value: 'compact-again' }],
      });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.code).toBe('VERSION_CONFLICT');
    expect(conflictRes.body.currentVersion).toBeDefined();
    expect(conflictRes.body.currentVersion).not.toBe(staleVersion);
    // The conflicting write was refused — value is still 'cozy', not 'compact-again'.
    expect(db.valueRows.find((r) => r.scope_type === 'org')?.value).toBe('cozy');
  });

  it('succeeds when expectedVersion matches the current resolved view', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);
    const auth = bearer({ userId: 'u1' });

    const first = await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, operations: [{ key: 'ui.theme.density', op: 'set', value: 'compact' }] });

    const res = await request(app)
      .put('/v1/config')
      .set('Authorization', auth)
      .send({
        namespace: NAMESPACE,
        scope: ORG_SCOPE,
        expectedVersion: first.body.version,
        operations: [{ key: 'ui.theme.density', op: 'set', value: 'cozy' }],
      });

    expect(res.status).toBe(200);
  });
});
