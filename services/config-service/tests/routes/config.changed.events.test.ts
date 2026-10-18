import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import { configureIdentity } from '@izzywdev/fuzefront-identity';
import { configChangedSchemaV1, ConfigChangedPayloadV1 } from '@fuzefront/shared/kafka';
import { createConfigWriteRouter } from '../../src/routes/config.write';
import { ConfigChangeNotifier } from '../../src/events/publisher';
import { FakeDb } from '../helpers/fakeDb';
import { bearer, TEST_JWT_SECRET } from '../helpers/authToken';
import { _setAuthzClientForTesting, makeNoOpProxy } from '../../src/middleware/authz';

beforeAll(() => {
  configureIdentity({ legacyUuidTypes: new Set(['portal', 'organization', 'user']) });
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});
afterEach(() => _setAuthzClientForTesting(makeNoOpProxy()));

const NS = 'fuzefront.chat';
const NS_ID = randomUUID();
const DENSITY = randomUUID();
const THEME = randomUUID();
const SECRET = randomUUID();
const ORG_SCOPE = { scopeType: 'org', scopeId: randomUUID() };

function recorder() {
  const calls: Array<{ payload: ConfigChangedPayloadV1; correlationId?: string }> = [];
  const notifier: ConfigChangeNotifier = {
    configChanged: jest.fn(async (payload, correlationId) => {
      calls.push({ payload, correlationId });
    }),
    disconnect: async () => {},
  };
  return { calls, notifier };
}

function setup(events?: ConfigChangeNotifier | null) {
  const db = new FakeDb();
  db.seedNamespace({ id: NS_ID, namespace: NS });
  db.seedKeyDef({ id: DENSITY, namespace_id: NS_ID, key: 'ui.density', value_type: 'string', default_value: 'a' });
  db.seedKeyDef({ id: THEME, namespace_id: NS_ID, key: 'ui.theme', value_type: 'string', default_value: 'a' });
  db.seedKeyDef({ id: SECRET, namespace_id: NS_ID, key: 'api.token', value_type: 'string', default_value: null, is_secret: true });
  const app = express();
  app.use(express.json());
  app.use(createConfigWriteRouter(db.pool, events));
  const put = (operations: unknown[], scope: unknown = ORG_SCOPE) =>
    request(app).put('/v1/config').set('Authorization', bearer({ userId: 'u1' })).send({ namespace: NS, scope, operations });
  return { db, put };
}

describe('config.changed — emitted after commit', () => {
  it.each([
    ['set', [{ key: 'ui.density', op: 'set', value: 'compact' }], undefined],
    ['unset', [{ key: 'ui.density', op: 'unset' }], { value: 'x' }],
    ['lock', [{ key: 'ui.density', op: 'lock', value: 'compact', lockReason: 'r' }], undefined],
    ['unlock', [{ key: 'ui.density', op: 'unlock' }], { value: 'x', is_locked: true }],
  ])('emits one event on %s', async (_name, ops, seed) => {
    const { calls, notifier } = recorder();
    const { db, put } = setup(notifier);
    if (seed) db.seedValue({ definition_id: DENSITY, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, ...(seed as object) } as never);
    const res = await put(ops);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual({ namespace: NS, scope: ORG_SCOPE, changedKeys: ['ui.density'] });
    expect(() => configChangedSchemaV1.parse(calls[0].payload)).not.toThrow();
    expect(calls[0].correlationId).toBeTruthy();
  });

  it('coalesces a multi-op batch into ONE event listing every changed key', async () => {
    const { calls, notifier } = recorder();
    const { put } = setup(notifier);
    const res = await put([
      { key: 'ui.density', op: 'set', value: 'compact' },
      { key: 'ui.theme', op: 'set', value: 'dark' },
      { key: 'api.token', op: 'set', value: 'hunter2' },
    ]);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.changedKeys.sort()).toEqual(['api.token', 'ui.density', 'ui.theme']);
  });

  it('emits platform scope with a null scopeId', async () => {
    const { calls, notifier } = recorder();
    const { put } = setup(notifier);
    const res = await put([{ key: 'ui.density', op: 'set', value: 'compact' }], { scopeType: 'platform', scopeId: null });
    expect(res.status).toBe(200);
    expect(calls[0].payload.scope).toEqual({ scopeType: 'platform', scopeId: null });
  });

  it('lists only the keys that really changed in a partially no-op batch', async () => {
    const { calls, notifier } = recorder();
    const { db, put } = setup(notifier);
    db.seedValue({ definition_id: DENSITY, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'same' });
    await put([
      { key: 'ui.density', op: 'set', value: 'same' },
      { key: 'ui.theme', op: 'set', value: 'dark' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.changedKeys).toEqual(['ui.theme']);
  });

  it('carries key names + scope only — never a value, even for an isSecret key', async () => {
    const { calls, notifier } = recorder();
    const { put } = setup(notifier);
    await put([{ key: 'api.token', op: 'set', value: 'hunter2-super-secret' }]);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].payload).sort()).toEqual(['changedKeys', 'namespace', 'scope']);
    expect(JSON.stringify(calls[0])).not.toContain('hunter2');
  });
});

describe('config.changed — NOT emitted', () => {
  it.each([
    ['re-setting the identical value', [{ key: 'ui.density', op: 'set', value: 'same' }], { value: 'same' }],
    ['unsetting a key with no override', [{ key: 'ui.density', op: 'unset' }], undefined],
    ['unlocking an unlocked row', [{ key: 'ui.density', op: 'unlock' }], { value: 'same' }],
    ['re-applying an identical lock', [{ key: 'ui.density', op: 'lock', value: 'same', lockReason: 'r' }], { value: 'same', is_locked: true, lock_reason: 'r' }],
  ])('no event on a no-op write: %s', async (_n, ops, seed) => {
    const { calls, notifier } = recorder();
    const { db, put } = setup(notifier);
    if (seed) db.seedValue({ definition_id: DENSITY, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, ...(seed as object) } as never);
    const res = await put(ops);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('no event when the transaction rolls back (a later op fails mid-batch)', async () => {
    const { calls, notifier } = recorder();
    const { db, put } = setup(notifier);
    // op 1 applies inside the tx; op 2 (unlock with nothing there) throws -> ROLLBACK.
    const res = await put([
      { key: 'ui.density', op: 'set', value: 'compact' },
      { key: 'ui.theme', op: 'unlock' },
    ]);
    expect(res.status).toBe(400);
    expect(db.valueRows).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('no event on a rejected request (validation / authz / conflict)', async () => {
    const { calls, notifier } = recorder();
    const { put } = setup(notifier);
    expect((await put([{ key: 'nope', op: 'set', value: 1 }])).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('config.changed — broker optional / non-fatal', () => {
  it('broker unset (no notifier): write succeeds, nothing emitted, no crash', async () => {
    for (const events of [undefined, null]) {
      const { put } = setup(events);
      const res = await put([{ key: 'ui.density', op: 'set', value: 'compact' }]);
      expect(res.status).toBe(200);
    }
  });

  it('a publisher that rejects does not fail the write', async () => {
    const notifier: ConfigChangeNotifier = {
      configChanged: () => Promise.reject(new Error('broker down')),
      disconnect: async () => {},
    };
    const { db, put } = setup(notifier);
    const res = await put([{ key: 'ui.density', op: 'set', value: 'compact' }]);
    expect(res.status).toBe(200);
    expect(db.valueRows).toHaveLength(1);
  });
});
