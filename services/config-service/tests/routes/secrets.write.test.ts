/**
 * Integration tests for POST /v1/config/secrets/reveal (FF-EPIC-18 /
 * FFRNT-280) — the reveal-once secret disclosure endpoint.
 *
 * SECURITY-FOCUSED by design, per CLAUDE.md's "an id is never a capability"
 * and the reveal-once contract: these tests exercise the fail-closed paths
 * (denied/undecidable authz, rate limiting, non-secret keys, no stored
 * value) at least as thoroughly as the happy path, and assert that
 * authorization comes from `checkAuthorization()` (the Security API call),
 * never merely from the caller having supplied a valid
 * namespace/scope/key address.
 */

import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import { AuthzClient } from '@fuzefront/auth';
import { configureIdentity } from '@izzywdev/fuzefront-identity';
import { createSecretsWriteRouter, RevealRateLimiter } from '../../src/routes/secrets.write';
import { FakeDb } from '../helpers/fakeDb';
import { bearer, TEST_JWT_SECRET } from '../helpers/authToken';
import { _setAuthzClientForTesting, makeNoOpProxy } from '../../src/middleware/authz';

beforeAll(() => {
  // governance/identifier-standard.md §8 — same widening as config.write.test.ts
  // /namespaces.write.test.ts/keys.write.test.ts: portal/organization/user ids
  // are not yet family-wide backfilled to the prefixed TypeID form, so the
  // scope_id values this suite seeds (bare UUIDs) need this to resolve.
  configureIdentity({ legacyUuidTypes: new Set(['portal', 'organization', 'user']) });
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterEach(() => {
  // Restore the default CI no-op (allow-everything) authz client between tests.
  _setAuthzClientForTesting(makeNoOpProxy());
});

function buildApp(db: FakeDb, rateLimiter?: RevealRateLimiter) {
  const app = express();
  app.use(express.json());
  app.use(createSecretsWriteRouter(db.pool, rateLimiter));
  return app;
}

const NAMESPACE_ID = randomUUID();
const NAMESPACE = 'fuzefront.chat';
const SECRET_DEF_ID = randomUUID();
const PLAIN_DEF_ID = randomUUID();
const HIDDEN_SECRET_DEF_ID = randomUUID();

function seedBase(db: FakeDb) {
  db.seedNamespace({ id: NAMESPACE_ID, namespace: NAMESPACE });
  db.seedKeyDef({
    id: SECRET_DEF_ID,
    namespace_id: NAMESPACE_ID,
    key: 'api.token',
    value_type: 'secret',
    default_value: null,
    allowed_scopes: ['platform', 'org'],
    is_secret: true,
  });
  db.seedKeyDef({
    id: PLAIN_DEF_ID,
    namespace_id: NAMESPACE_ID,
    key: 'ui.theme.density',
    value_type: 'string',
    default_value: 'comfortable',
    allowed_scopes: ['platform', 'org'],
    is_secret: false,
  });
  db.seedKeyDef({
    id: HIDDEN_SECRET_DEF_ID,
    namespace_id: NAMESPACE_ID,
    key: 'hidden.secret',
    value_type: 'secret',
    default_value: null,
    allowed_scopes: ['platform'],
    is_secret: true,
    is_hidden: true,
  });
}

const ORG_SCOPE = { scopeType: 'org', scopeId: randomUUID() };

function revealBody(overrides: Record<string, unknown> = {}) {
  return {
    namespace: NAMESPACE,
    scope: ORG_SCOPE,
    key: 'api.token',
    reason: 'debugging a webhook failure',
    ...overrides,
  };
}

describe('POST /v1/config/secrets/reveal — auth', () => {
  it('401s with no credential', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app).post('/v1/config/secrets/reveal').send(revealBody());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('403s when the Security API denies the reveal grant', async () => {
    _setAuthzClientForTesting({ check: async () => ({ allow: false }), bulkCheck: async () => [] } as unknown as AuthzClient);
    const db = new FakeDb();
    seedBase(db);
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-live-secret' });
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('fails CLOSED (403, not 500 / not allowed) when the Security API is unreachable', async () => {
    _setAuthzClientForTesting({
      check: async () => {
        throw new Error('DECISION_UNAVAILABLE');
      },
      bulkCheck: async () => [],
    } as unknown as AuthzClient);
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody());

    expect(res.status).toBe(403);
  });

  it('checks the reveal action as a DISTINCT grant, never derived from write authority, and never satisfied merely by the request naming a valid namespace/scope/key', async () => {
    // The Security API is asked for 'reveal' — a caller who could pass a
    // 'write' check is not asked here at all, and the mock below proves the
    // action string reaching checkAuthorization is exactly 'reveal'.
    const check = jest.fn().mockResolvedValue({ allow: true });
    _setAuthzClientForTesting({ check, bulkCheck: async () => [] } as unknown as AuthzClient);
    const db = new FakeDb();
    seedBase(db);
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-live-secret' });
    const app = buildApp(db);

    await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody());

    expect(check).toHaveBeenCalledWith(expect.objectContaining({ action: 'reveal' }), expect.any(String));
  });

  it('403s BEFORE checking namespace/key existence — a denial leaks nothing about whether the secret exists', async () => {
    _setAuthzClientForTesting({ check: async () => ({ allow: false }), bulkCheck: async () => [] } as unknown as AuthzClient);
    const db = new FakeDb(); // no namespace registered at all — would 404 if reached
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ namespace: 'fuzefront.does-not-exist' }));

    expect(res.status).toBe(403);
  });
});

describe('POST /v1/config/secrets/reveal — shape validation', () => {
  it('400s a missing reason (required, unlike ConfigWriteRequest.reason)', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send({ namespace: NAMESPACE, scope: ORG_SCOPE, key: 'api.token' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400s an unknown property (additionalProperties: false)', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ id: 'cvl_smuggled' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400s scopeId supplied for the platform singleton tier', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ scope: { scopeType: 'platform', scopeId: 'nope' } }));

    expect(res.status).toBe(400);
  });
});

describe('POST /v1/config/secrets/reveal — resolution', () => {
  it('404s when the namespace does not exist', async () => {
    const db = new FakeDb();
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ namespace: 'fuzefront.nope' }));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('404s when the key does not exist in that namespace', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ key: 'no.such.key' }));

    expect(res.status).toBe(404);
  });

  it('404s a hidden secret key — same masking as every other lookup, never confirms existence', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ key: 'hidden.secret', scope: { scopeType: 'platform', scopeId: null } }));

    expect(res.status).toBe(404);
  });

  it('400s VALIDATION_ERROR when the key exists but is not isSecret', async () => {
    const db = new FakeDb();
    seedBase(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ key: 'ui.theme.density' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('404s isSet:false — no value stored at this EXACT scope (a value at a DIFFERENT scope does not count)', async () => {
    const db = new FakeDb();
    seedBase(db);
    // Value stored at platform, but the request asks for the org scope.
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'platform', scope_id: null, value: 'sk-live-platform' });
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('POST /v1/config/secrets/reveal — success', () => {
  it('200s with the plaintext exactly once, Cache-Control: no-store, and a historyEntryId', async () => {
    const db = new FakeDb();
    seedBase(db);
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-live-abc123' });
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody());

    expect(res.status).toBe(200);
    expect(res.body.value).toBe('sk-live-abc123');
    expect(res.body.namespace).toBe(NAMESPACE);
    expect(res.body.key).toBe('api.token');
    expect(res.body.scope).toEqual(ORG_SCOPE);
    expect(typeof res.body.revealedAt).toBe('string');
    expect(res.body.historyEntryId).toMatch(/^cvh_/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('writes a redacted `reveal` history entry against the caller, with the reason recorded', async () => {
    const db = new FakeDb();
    seedBase(db);
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-live-abc123' });
    const app = buildApp(db);

    await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ reason: 'incident-4821' }));

    expect(db.historyRows).toHaveLength(1);
    const entry = db.historyRows[0];
    expect(entry.action).toBe('reveal');
    expect(entry.redacted).toBe(true);
    expect(entry.old_value).toBeNull();
    expect(entry.new_value).toBeNull();
    expect(entry.reason).toBe('incident-4821');
    expect(entry.actor_type).toBe('user');
  });

  it('every attempt against a resolved secret writes its own history entry — even a 404 isSet:false one', async () => {
    const db = new FakeDb();
    seedBase(db);
    // No value seeded at all — isSet: false.
    const app = buildApp(db);

    const res = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody());

    expect(res.status).toBe(404);
    expect(db.historyRows).toHaveLength(1);
    expect(db.historyRows[0].action).toBe('reveal');
  });

  it('two reveals of the same secret each get their OWN history entry (never cached/re-served)', async () => {
    const db = new FakeDb();
    seedBase(db);
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-live-abc123' });
    // A generous limiter — this test is about history entries, not throttling.
    const app = buildApp(db, new RevealRateLimiter(10, 60_000));

    const first = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody());
    const second = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.historyEntryId).not.toBe(second.body.historyEntryId);
    expect(db.historyRows.filter((r) => r.action === 'reveal')).toHaveLength(2);
  });
});

describe('POST /v1/config/secrets/reveal — throttling (fail-closed, not decoration)', () => {
  it('429s after the configured attempt budget is exhausted for one (subject, scope, key)', async () => {
    const db = new FakeDb();
    seedBase(db);
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-live-abc123' });
    const app = buildApp(db, new RevealRateLimiter(2, 60_000));

    const first = await request(app).post('/v1/config/secrets/reveal').set('Authorization', bearer({ userId: 'u1' })).send(revealBody());
    const second = await request(app).post('/v1/config/secrets/reveal').set('Authorization', bearer({ userId: 'u1' })).send(revealBody());
    const third = await request(app).post('/v1/config/secrets/reveal').set('Authorization', bearer({ userId: 'u1' })).send(revealBody());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('RATE_LIMITED');
  });

  it('a 429 still writes its own reveal history entry (an attempted disclosure is itself auditable)', async () => {
    const db = new FakeDb();
    seedBase(db);
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-live-abc123' });
    const app = buildApp(db, new RevealRateLimiter(1, 60_000));

    await request(app).post('/v1/config/secrets/reveal').set('Authorization', bearer({ userId: 'u1' })).send(revealBody());
    const blocked = await request(app).post('/v1/config/secrets/reveal').set('Authorization', bearer({ userId: 'u1' })).send(revealBody());

    expect(blocked.status).toBe(429);
    expect(db.historyRows.filter((r) => r.action === 'reveal')).toHaveLength(2);
  });

  it("throttles per (subject, namespace, scope, key) — a DIFFERENT secret for the SAME caller is not blocked by the first's window", async () => {
    const db = new FakeDb();
    seedBase(db);
    const otherSecretId = randomUUID();
    db.seedKeyDef({
      id: otherSecretId,
      namespace_id: NAMESPACE_ID,
      key: 'other.secret',
      value_type: 'secret',
      default_value: null,
      allowed_scopes: ['org'],
      is_secret: true,
    });
    db.seedValue({ definition_id: SECRET_DEF_ID, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-a' });
    db.seedValue({ definition_id: otherSecretId, scope_type: 'org', scope_id: ORG_SCOPE.scopeId, value: 'sk-b' });
    const app = buildApp(db, new RevealRateLimiter(1, 60_000));

    const first = await request(app).post('/v1/config/secrets/reveal').set('Authorization', bearer({ userId: 'u1' })).send(revealBody());
    const secondBlocked = await request(app).post('/v1/config/secrets/reveal').set('Authorization', bearer({ userId: 'u1' })).send(revealBody());
    const otherKey = await request(app)
      .post('/v1/config/secrets/reveal')
      .set('Authorization', bearer({ userId: 'u1' }))
      .send(revealBody({ key: 'other.secret' }));

    expect(first.status).toBe(200);
    expect(secondBlocked.status).toBe(429);
    expect(otherKey.status).toBe(200);
  });
});
