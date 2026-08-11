/**
 * Integration tests for the GET half of the config-service HTTP surface
 * (FFRNT-157 / FF-EPIC-17-S5), exercised through the real Express router with
 * hand-written in-memory repository fakes (satisfying the same TS interfaces
 * `PgNamespaceRepository`/`PgKeyDefinitionRepository`/`PgValueRepository`
 * implement) — the SQL layer is covered separately by the repository unit
 * tests (mocked `pg.Pool`), so this suite exercises route wiring: auth,
 * Permit ordering, pagination envelope/clamp, ETag/If-None-Match, hidden-key
 * omission, and the frozen-contract response shapes.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { mintId } from '@izzywdev/fuzefront-identity';
import { createConfigReadRouter } from '../../src/routes/config-read.routes';
import { _setPermitClientForTesting, makeNoOpProxy } from '../../src/middleware/permit';
import { NamespaceRepository, ListNamespacesArgs, ListNamespacesResult } from '../../src/repositories/namespace.repository';
import {
  KeyDefinitionRepository,
  ListKeyDefinitionsArgs,
  ListKeyDefinitionsResult,
} from '../../src/repositories/key-definition.repository';
import { ValueRepository, SetValueInput } from '../../src/repositories/value.repository';
import { ConfigValue, KeyDefinition, Namespace, NamespaceEntityId, Scope } from '../../src/types';
import { decodeCursor, encodeCursor } from '../../src/pagination';

const JWT_SECRET = 'test-secret-ffrnt-157-routes';
process.env.JWT_SECRET = JWT_SECRET;

function token(overrides: Record<string, unknown> = {}): string {
  return jwt.sign({ userId: 'usr_1', ...overrides }, JWT_SECRET);
}

// ─── In-memory fakes ────────────────────────────────────────────────────────

class FakeNamespaceRepository implements NamespaceRepository {
  constructor(public namespaces: Namespace[] = []) {}

  async findByName(namespace: string): Promise<Namespace | null> {
    return this.namespaces.find((n) => n.namespace === namespace) ?? null;
  }
  async findById(id: NamespaceEntityId): Promise<Namespace | null> {
    return this.namespaces.find((n) => n.id === id) ?? null;
  }
  async upsert(): Promise<{ namespace: Namespace; created: boolean }> {
    throw new Error('not implemented — FFRNT-158 owns writes');
  }
  async listPage(args: ListNamespacesArgs): Promise<ListNamespacesResult> {
    const sorted = [...this.namespaces].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || (b.id > a.id ? 1 : -1),
    );
    let startIndex = 0;
    if (args.cursor) {
      const c = decodeCursor<{ createdAt: string; id: string }>(args.cursor);
      if (c) {
        startIndex = sorted.findIndex((n) => n.createdAt === c.createdAt && n.id === c.id) + 1;
      }
    }
    const window = sorted.slice(startIndex, startIndex + args.limit + 1);
    const hasNextPage = window.length > args.limit;
    const items = hasNextPage ? window.slice(0, args.limit) : window;
    const last = items[items.length - 1];
    const nextCursor = hasNextPage && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
    return { items, pageInfo: { hasNextPage, nextCursor } };
  }
}

class FakeKeyDefinitionRepository implements KeyDefinitionRepository {
  constructor(public definitions: KeyDefinition[] = []) {}

  async listByNamespace(namespaceId: string): Promise<KeyDefinition[]> {
    return this.definitions
      .filter((d) => d.namespaceId === namespaceId)
      .sort((a, b) => a.key.localeCompare(b.key));
  }
  async findByKey(namespaceId: string, key: string): Promise<KeyDefinition | null> {
    return this.definitions.find((d) => d.namespaceId === namespaceId && d.key === key) ?? null;
  }
  async create(): Promise<KeyDefinition> {
    throw new Error('not implemented — FFRNT-158 owns writes');
  }
  async listPage(namespaceId: string, args: ListKeyDefinitionsArgs): Promise<ListKeyDefinitionsResult> {
    let rows = this.definitions
      .filter((d) => d.namespaceId === namespaceId)
      .filter((d) => args.includeHidden || !d.isHidden)
      .filter((d) => !args.category || d.category === args.category)
      .filter(
        (d) =>
          !args.search ||
          d.displayName.toLowerCase().includes(args.search.toLowerCase()) ||
          (d.description ?? '').toLowerCase().includes(args.search.toLowerCase()),
      )
      .sort((a, b) => a.key.localeCompare(b.key));

    if (args.cursor) {
      const c = decodeCursor<{ key: string }>(args.cursor);
      if (c) rows = rows.filter((d) => d.key > c.key);
    }
    const window = rows.slice(0, args.limit + 1);
    const hasNextPage = window.length > args.limit;
    const items = hasNextPage ? window.slice(0, args.limit) : window;
    const last = items[items.length - 1];
    const nextCursor = hasNextPage && last ? encodeCursor({ key: last.key }) : null;
    return { items, pageInfo: { hasNextPage, nextCursor } };
  }
}

class FakeValueRepository implements ValueRepository {
  constructor(public values: ConfigValue[] = []) {}

  async listForDefinitions(definitionIds: string[], scopes: Scope[]): Promise<ConfigValue[]> {
    return this.values.filter(
      (v) =>
        definitionIds.includes(v.definitionId) &&
        scopes.some((s) => s.scopeType === v.scopeType && s.scopeId === v.scopeId),
    );
  }
  async setValue(): Promise<ConfigValue> {
    throw new Error('not implemented — FFRNT-158 owns writes');
  }
  async unsetValue(): Promise<void> {
    throw new Error('not implemented — FFRNT-158 owns writes');
  }
}

// ─── Fixture builders ───────────────────────────────────────────────────────

let seq = 0;
function makeNamespace(overrides: Partial<Namespace> = {}): Namespace {
  seq += 1;
  return {
    id: mintId('namespace'),
    namespace: `fuzefront.ns${seq}`,
    displayName: `NS ${seq}`,
    description: null,
    ownerAppId: null,
    createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    ...overrides,
  };
}

function makeDefinition(namespaceId: string, overrides: Partial<KeyDefinition> = {}): KeyDefinition {
  seq += 1;
  return {
    id: mintId('keyDefinition'),
    namespaceId: namespaceId as KeyDefinition['namespaceId'],
    key: `key.${seq}`,
    displayName: `Key ${seq}`,
    description: null,
    helpUrl: null,
    category: null,
    sortOrder: 0,
    tags: [],
    valueType: 'string',
    schema: null,
    enumValues: null,
    defaultValue: 'default',
    allowedScopes: ['platform', 'portal', 'org', 'user'],
    isSystem: false,
    isHidden: false,
    isSecret: false,
    isReadonly: false,
    precedence: 'most-specific-wins',
    requiresRestart: false,
    deprecatedAt: null,
    replacedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeApp(deps: {
  namespaces?: Namespace[];
  definitions?: KeyDefinition[];
  values?: ConfigValue[];
}) {
  const namespaceRepo = new FakeNamespaceRepository(deps.namespaces ?? []);
  const keyDefinitionRepo = new FakeKeyDefinitionRepository(deps.definitions ?? []);
  const valueRepo = new FakeValueRepository(deps.values ?? []);
  const app = express();
  app.use(express.json());
  app.use('/v1', createConfigReadRouter({ namespaceRepo, keyDefinitionRepo, valueRepo }));
  return { app, namespaceRepo, keyDefinitionRepo, valueRepo };
}

beforeEach(() => {
  _setPermitClientForTesting({ check: jest.fn().mockResolvedValue(true) });
});
afterEach(() => {
  _setPermitClientForTesting(makeNoOpProxy());
});

// ─── Auth ───────────────────────────────────────────────────────────────────

describe('GET /v1/* — auth', () => {
  it.each([
    ['/v1/namespaces'],
    ['/v1/namespaces/fuzefront.chat/keys'],
    ['/v1/namespaces/fuzefront.chat/keys/some.key'],
    ['/v1/config?namespace=fuzefront.chat&scopeType=platform'],
  ])('401s %s with no Authorization header', async (path) => {
    const { app } = makeApp({});
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

// ─── GET /v1/namespaces ─────────────────────────────────────────────────────

describe('GET /v1/namespaces', () => {
  it('returns the PagedNamespaces envelope', async () => {
    const namespaces = [makeNamespace(), makeNamespace()];
    const { app } = makeApp({ namespaces });

    const res = await request(app).get('/v1/namespaces').set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        items: expect.any(Array),
        pageInfo: expect.objectContaining({ hasNextPage: expect.any(Boolean) }),
      }),
    );
    expect(res.body.items).toHaveLength(2);
  });

  it('clamps an over-max limit server-side (gate-pagination)', async () => {
    const namespaces = Array.from({ length: 250 }, () => makeNamespace());
    const { app } = makeApp({ namespaces });

    const res = await request(app)
      .get('/v1/namespaces?limit=99999')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(200); // MAX_LIMIT
    expect(res.body.pageInfo.hasNextPage).toBe(true);
  });

  it('walks the full set via nextCursor with no gaps or duplicates', async () => {
    const namespaces = Array.from({ length: 27 }, () => makeNamespace());
    const { app } = makeApp({ namespaces });

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const qs = cursor ? `?limit=5&cursor=${encodeURIComponent(cursor)}` : '?limit=5';
      const res = await request(app).get(`/v1/namespaces${qs}`).set('Authorization', `Bearer ${token()}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((n: Namespace) => n.id));
      if (!res.body.pageInfo.hasNextPage) break;
      cursor = res.body.pageInfo.nextCursor;
    }

    expect(seen).toHaveLength(27);
    expect(new Set(seen).size).toBe(27);
  });

  it('403s when Permit denies', async () => {
    _setPermitClientForTesting({ check: jest.fn().mockResolvedValue(false) });
    const { app } = makeApp({ namespaces: [makeNamespace()] });

    const res = await request(app).get('/v1/namespaces').set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

// ─── GET /v1/namespaces/:namespace/keys ─────────────────────────────────────

describe('GET /v1/namespaces/:namespace/keys', () => {
  it('404s when the namespace does not exist', async () => {
    const { app } = makeApp({});
    const res = await request(app)
      .get('/v1/namespaces/fuzefront.nonexistent/keys')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('omits isHidden keys by default (server-side, per S5 AC3)', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const visible = makeDefinition(ns.id, { key: 'visible.key' });
    const hidden = makeDefinition(ns.id, { key: 'hidden.key', isHidden: true });
    const { app } = makeApp({ namespaces: [ns], definitions: [visible, hidden] });

    const res = await request(app)
      .get('/v1/namespaces/fuzefront.chat/keys')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((k: any) => k.key)).toEqual(['visible.key']);
  });

  it('403s a non-admin caller passing includeHidden=true, without leaking the hidden keys', async () => {
    // First call ('read') allowed, second ('admin') denied.
    const check = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    _setPermitClientForTesting({ check });
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const { app } = makeApp({ namespaces: [ns], definitions: [makeDefinition(ns.id, { isHidden: true })] });

    const res = await request(app)
      .get('/v1/namespaces/fuzefront.chat/keys?includeHidden=true')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(403);
  });

  it('includes isHidden keys for an admin passing includeHidden=true', async () => {
    _setPermitClientForTesting({ check: jest.fn().mockResolvedValue(true) });
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const hidden = makeDefinition(ns.id, { key: 'hidden.key', isHidden: true });
    const { app } = makeApp({ namespaces: [ns], definitions: [hidden] });

    const res = await request(app)
      .get('/v1/namespaces/fuzefront.chat/keys?includeHidden=true')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((k: any) => k.key)).toEqual(['hidden.key']);
  });

  it('clamps limit and returns the PagedKeyDefinitions envelope', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const defs = Array.from({ length: 10 }, () => makeDefinition(ns.id));
    const { app } = makeApp({ namespaces: [ns], definitions: defs });

    const res = await request(app)
      .get('/v1/namespaces/fuzefront.chat/keys?limit=3')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.pageInfo.hasNextPage).toBe(true);
    expect(typeof res.body.pageInfo.nextCursor).toBe('string');
  });
});

// ─── GET /v1/namespaces/:namespace/keys/:key ────────────────────────────────

describe('GET /v1/namespaces/:namespace/keys/:key', () => {
  it('404s when the namespace does not exist', async () => {
    const { app } = makeApp({});
    const res = await request(app)
      .get('/v1/namespaces/fuzefront.nope/keys/some.key')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('404s when the key does not exist', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const { app } = makeApp({ namespaces: [ns] });
    const res = await request(app)
      .get('/v1/namespaces/fuzefront.chat/keys/nope.key')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('404s (not 200-with-a-flag) when the key is isHidden — same response as absent', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const hidden = makeDefinition(ns.id, { key: 'secret.key', isHidden: true });
    const { app } = makeApp({ namespaces: [ns], definitions: [hidden] });
    const res = await request(app)
      .get('/v1/namespaces/fuzefront.chat/keys/secret.key')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('200s with the key definition when found and visible', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const def = makeDefinition(ns.id, { key: 'ui.theme.density', displayName: 'Density' });
    const { app } = makeApp({ namespaces: [ns], definitions: [def] });
    const res = await request(app)
      .get('/v1/namespaces/fuzefront.chat/keys/ui.theme.density')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('ui.theme.density');
    expect(res.body.displayName).toBe('Density');
    // Internal-only fields are not on the wire.
    expect(res.body.namespaceId).toBeUndefined();
    expect(res.body.createdAt).toBeUndefined();
  });
});

// ─── GET /v1/config ─────────────────────────────────────────────────────────

describe('GET /v1/config', () => {
  it('400s when namespace is missing', async () => {
    const { app } = makeApp({});
    const res = await request(app)
      .get('/v1/config?scopeType=platform')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400s on an invalid scopeType', async () => {
    const { app } = makeApp({});
    const res = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=galaxy')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
  });

  it('400s when scopeId is supplied for the platform singleton tier', async () => {
    const { app } = makeApp({});
    const res = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=platform&scopeId=nope')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
  });

  it('400s when scopeId is missing for a non-platform tier', async () => {
    const { app } = makeApp({});
    const res = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=org')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(400);
  });

  it('403s BEFORE checking namespace existence — leaks nothing about whether the scope exists (S5 AC4)', async () => {
    _setPermitClientForTesting({ check: jest.fn().mockResolvedValue(false) });
    const { app } = makeApp({}); // no namespaces at all — would 404 if reached

    const res = await request(app)
      .get('/v1/config?namespace=fuzefront.does-not-exist&scopeType=org&scopeId=org_1')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(403);
  });

  it('404s when the namespace does not exist (and the caller IS authorized)', async () => {
    const { app } = makeApp({});
    const res = await request(app)
      .get('/v1/config?namespace=fuzefront.nope&scopeType=platform')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  it('resolves and returns entries with provenance; hidden keys absent, secrets never leak a value', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const visible = makeDefinition(ns.id, { key: 'visible.key', defaultValue: 'v' });
    const hidden = makeDefinition(ns.id, { key: 'hidden.key', isHidden: true });
    const secret = makeDefinition(ns.id, {
      key: 'secret.key',
      valueType: 'secret',
      isSecret: true,
      defaultValue: null,
    });
    const { app } = makeApp({ namespaces: [ns], definitions: [visible, hidden, secret] });

    const res = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=platform')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    const keys = res.body.entries.map((e: any) => e.key);
    expect(keys).toEqual(['secret.key', 'visible.key']); // sorted by key from listByNamespace's fake
    expect(keys).not.toContain('hidden.key');
    const secretEntry = res.body.entries.find((e: any) => e.key === 'secret.key');
    expect(secretEntry.value).toBeNull();
    expect(secretEntry.isSet).toBe(false);
    expect(res.body.namespace).toBe('fuzefront.chat');
    expect(res.body.scope).toEqual({ scopeType: 'platform', scopeId: null });
    expect(typeof res.body.version).toBe('string');
  });

  it('returns an ETag and honours If-None-Match with a 304 (no body) when unchanged', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const def = makeDefinition(ns.id, { key: 'k', defaultValue: 'v' });
    const { app } = makeApp({ namespaces: [ns], definitions: [def] });

    const first = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=platform')
      .set('Authorization', `Bearer ${token()}`);
    expect(first.status).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const second = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=platform')
      .set('Authorization', `Bearer ${token()}`)
      .set('If-None-Match', etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  it('a stale If-None-Match (value changed at an ancestor scope) gets a full 200, not a 304', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const def = makeDefinition(ns.id, { key: 'k', defaultValue: 'v', allowedScopes: ['platform'] });
    const { app, valueRepo } = makeApp({ namespaces: [ns], definitions: [def] });

    const first = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=platform')
      .set('Authorization', `Bearer ${token()}`);
    const staleEtag = first.headers.etag;

    // A platform-level override lands (an "ancestor changes too" scenario for
    // any deeper scope; here platform IS the target, exercising the same
    // "the version tracks the RESOLVED view" contract requirement directly).
    valueRepo.values.push({
      id: 'val_1',
      definitionId: def.id,
      scopeType: 'platform',
      scopeId: null,
      value: 'new-value',
      isLocked: false,
      lockReason: null,
      setByUserId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const second = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=platform')
      .set('Authorization', `Bearer ${token()}`)
      .set('If-None-Match', staleEtag);

    expect(second.status).toBe(200);
    expect(second.body.entries[0].value).toBe('new-value');
  });

  it('treats a malformed If-None-Match as absent — answers 200, not an error', async () => {
    const ns = makeNamespace({ namespace: 'fuzefront.chat' });
    const def = makeDefinition(ns.id, { key: 'k' });
    const { app } = makeApp({ namespaces: [ns], definitions: [def] });

    const res = await request(app)
      .get('/v1/config?namespace=fuzefront.chat&scopeType=platform')
      .set('Authorization', `Bearer ${token()}`)
      .set('If-None-Match', 'garbage-not-a-real-etag');

    expect(res.status).toBe(200);
  });
});
