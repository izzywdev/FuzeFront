// authz.route-matrix.test.ts — review H-3 (tenant-level checks must not reuse
// per-list actions), M-1 (item purge is owner-only) and L-1 (PATCH status
// archive needs the archive action).
//
// WHAT THIS PINS. The REAL app (every router, the real middleware chain) is
// driven with a recording Security API client, and the (resource, key, action)
// triples each route asks for are compared with the matrix below — the
// service-side mirror of docs/planning/selection-lists-permit-actions.md:
//
//   tenant-level (keyless `SelectionListCatalog`):
//       GET  /v1/selection-lists        -> list
//       POST /v1/selection-lists        -> create
//       GET  /v1/selection-lists/quota  -> read_quota
//       POST /v1/resolve                -> resolve
//   everything addressed to one list: `SelectionList` keyed on the list id.
//
// TABLE-DRIVEN OVER EVERY ROUTE. The set of routes is DISCOVERED from the
// mounted Express app and compared with the table, so a new route that is not
// added to the table fails this suite — and a route that is added to the table
// but never asks the Security API fails its row. A future route cannot silently
// miss a check.

jest.mock('../src/db', () => {
  const chain: any = {};
  chain.where = () => chain;
  chain.first = async () => ({ id: 'front_sl_01testlistid000000000000' });
  const mockDb: any = jest.fn(() => chain);
  mockDb.raw = jest.fn(async () => ({ rows: [] }));
  mockDb.transaction = jest.fn(async () => {
    throw new Error('db.transaction unavailable in this test');
  });
  mockDb.fn = { now: () => 'now()' };
  return { db: mockDb };
});

jest.mock('../src/middleware/quota', () => ({
  enforceListQuota: (_req: any, _res: any, next: any) => next(),
  enforceItemQuota: (_req: any, _res: any, next: any) => next(),
  sendQuotaExceeded: jest.requireActual('../src/middleware/quota').sendQuotaExceeded,
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { AuthzClient } from '@fuzefront/auth';
import { createApp } from '../src/app';
import { setFlagClient } from '../src/flags';
import { db } from '../src/db';
import {
  _setAuthzClientForTesting,
  makeNoOpProxy,
  filterReadable,
  SELECTION_LIST_CATALOG_RESOURCE,
  SELECTION_LIST_RESOURCE,
} from '../src/middleware/authz';

const ENV_VAR = 'FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED';
const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-authz-matrix';

const USER = 'usr_01testuserid0000000000000';
const ORG = 'org_01testorgid00000000000000';
const LIST = 'front_sl_01testlistid000000000000';
const ITEM = 'front_sli_01testitemid00000000000';
const OTHER_USER = 'usr_01otheruserid000000000000';

const CATALOG = SELECTION_LIST_CATALOG_RESOURCE;
const LIST_RES = SELECTION_LIST_RESOURCE;

const bearerHeader = () => ({
  Authorization: `Bearer ${jwt.sign({ userId: USER, orgId: ORG }, JWT_SECRET)}`,
});

interface Expected {
  type: string;
  /** the instance key; `undefined` means the check must be KEYLESS (tenant-level) */
  key?: string;
  action: string;
}

interface Row {
  /** `${METHOD} ${express path template}` as mounted by createApp() */
  route: string;
  /** which variant of the route (query/body) this row drives */
  label?: string;
  query?: Record<string, string>;
  body?: unknown;
  /** ordered SelectionList* checks the route must ask for */
  checks: Expected[];
}

const onList = (action: string): Expected[] => [{ type: LIST_RES, key: LIST, action }];

// One row per route VARIANT. Order within `checks` is the order asked.
const MATRIX: Row[] = [
  // ── tenant-level: SelectionListCatalog, keyless ──────────────────────────
  { route: 'GET /v1/selection-lists', checks: [{ type: CATALOG, action: 'list' }] },
  { route: 'POST /v1/selection-lists', body: { key: 'k', name: 'N' }, checks: [{ type: CATALOG, action: 'create' }] },
  { route: 'GET /v1/selection-lists/quota', checks: [{ type: CATALOG, action: 'read_quota' }] },
  { route: 'POST /v1/resolve', body: { ids: [ITEM] }, checks: [{ type: CATALOG, action: 'resolve' }] },

  // ── per list ─────────────────────────────────────────────────────────────
  { route: 'GET /v1/selection-lists/:listId', checks: onList('read') },
  { route: 'PATCH /v1/selection-lists/:listId', label: 'no status change', body: { name: 'N' }, checks: onList('update') },
  { route: 'PATCH /v1/selection-lists/:listId', label: 'status=active (unarchive)', body: { status: 'active' }, checks: onList('update') },
  {
    route: 'PATCH /v1/selection-lists/:listId',
    label: 'status=archived (archive, review L-1)',
    body: { status: 'archived' },
    checks: [...onList('update'), ...onList('delete')],
  },
  { route: 'DELETE /v1/selection-lists/:listId', checks: onList('delete') },
  { route: 'POST /v1/selection-lists/:listId/archive', checks: onList('delete') },

  { route: 'GET /v1/selection-lists/:listId/items', checks: onList('read') },
  { route: 'POST /v1/selection-lists/:listId/items', body: { code: 'c', label: 'L' }, checks: onList('add_value') },
  { route: 'PUT /v1/selection-lists/:listId/items/reorder', body: { ids: [ITEM] }, checks: onList('update_value') },
  { route: 'PATCH /v1/selection-lists/:listId/items/:itemId', body: { label: 'L' }, checks: onList('update_value') },
  { route: 'DELETE /v1/selection-lists/:listId/items/:itemId', label: 'archive (default)', checks: onList('remove_value') },
  {
    route: 'DELETE /v1/selection-lists/:listId/items/:itemId',
    label: 'purge=true (review M-1)',
    query: { purge: 'true' },
    checks: [...onList('remove_value'), ...onList('delete')],
  },
  { route: 'POST /v1/selection-lists/:listId/items/:itemId/archive', checks: onList('remove_value') },

  { route: 'GET /v1/selection-lists/:listId/translations', checks: onList('read') },
  { route: 'PUT /v1/selection-lists/:listId/translations/:locale', body: { name: 'N' }, checks: onList('translate') },
  { route: 'DELETE /v1/selection-lists/:listId/translations/:locale', checks: onList('translate') },
  { route: 'POST /v1/selection-lists/:listId/translations/:locale/autofill', body: {}, checks: onList('translate') },
  { route: 'GET /v1/selection-lists/:listId/items/:itemId/translations', checks: onList('read') },
  { route: 'PUT /v1/selection-lists/:listId/items/:itemId/translations/:locale', body: { label: 'L' }, checks: onList('translate') },
  { route: 'DELETE /v1/selection-lists/:listId/items/:itemId/translations/:locale', checks: onList('translate') },

  { route: 'GET /v1/selection-lists/:listId/access', checks: onList('manage_access') },
  { route: 'PUT /v1/selection-lists/:listId/access/:userId', body: { role: 'list-viewer' }, checks: onList('manage_access') },
  { route: 'DELETE /v1/selection-lists/:listId/access/:userId', checks: onList('manage_access') },
];

// ─── harness ──────────────────────────────────────────────────────────────────

let app: ReturnType<typeof createApp>;
const asked: Array<{ subject: string; tenant: string; resource: { type: string; key?: string }; action: string }> = [];
let decide: (q: { resource: { type: string; key?: string }; action: string }) => boolean | Error;

function recordingClient(): AuthzClient {
  return {
    check: jest.fn(async (q: any) => {
      asked.push(q);
      const d = decide(q);
      if (d instanceof Error) throw d;
      return { allow: d };
    }),
    bulkCheck: jest.fn(async (qs: any[]) =>
      qs.map((q) => {
        asked.push(q);
        const d = decide(q);
        if (d instanceof Error) throw d;
        return { allow: d };
      }),
    ),
    grant: jest.fn(async (r: any) => r),
    revoke: jest.fn(async () => undefined),
    listGrants: jest.fn(async () => ({ items: [], page: { nextCursor: null, hasMore: false } })),
    setAttributes: jest.fn(),
  } as unknown as AuthzClient;
}

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env[ENV_VAR] = 'true'; // non-production: honoured -> real decisions
  app = createApp();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env[ENV_VAR];
  setFlagClient(null);
  _setAuthzClientForTesting(makeNoOpProxy());
});

beforeEach(() => {
  asked.length = 0;
  decide = () => true;
  setFlagClient({ getBooleanValue: async () => true });
  _setAuthzClientForTesting(recordingClient());
  (db.raw as unknown as jest.Mock).mockReset().mockResolvedValue({ rows: [] });
  (db.transaction as unknown as jest.Mock).mockClear();
});

const concrete = (route: string): { method: string; url: string } => {
  const [method, path] = route.split(' ');
  return {
    method: method.toLowerCase(),
    url: path
      .replace(':listId', LIST)
      .replace(':itemId', ITEM)
      .replace(':locale', 'fr')
      .replace(':userId', OTHER_USER),
  };
};

async function fire(row: Row): Promise<request.Response> {
  const { method, url } = concrete(row.route);
  let req: request.Test = (request(app) as any)[method](url).set(bearerHeader());
  if (row.query) req = req.query(row.query);
  if (row.body !== undefined) req = req.send(row.body as object);
  return req;
}

/** Only the SelectionList / SelectionListCatalog checks (access.ts also asks Organization:read). */
const selectionListChecks = (): Expected[] =>
  asked
    .filter((q) => q.resource.type === LIST_RES || q.resource.type === CATALOG)
    .map((q) => ({ type: q.resource.type, key: q.resource.key, action: q.action }));

/** Every HTTP route the app mounts under /v1, e.g. `PATCH /v1/selection-lists/:listId`. */
function discoverRoutes(): string[] {
  const found: string[] = [];
  for (const layer of (app as any)._router.stack) {
    if (layer.name !== 'router') continue;
    const mount: string = layer.regexp.source
      .replace(/^\^/, '')
      .replace(/\\\//g, '/')
      .replace(/\/\?\(\?=\/\|\$\)$/, '');
    if (!mount.startsWith('/v1')) continue; // /docs, /health, /ready, /metrics are unauthenticated by design
    for (const l of layer.handle.stack) {
      if (!l.route) continue;
      const routePath: string = l.route.path === '/' ? '' : l.route.path;
      for (const method of Object.keys(l.route.methods)) {
        found.push(`${method.toUpperCase()} ${mount}${routePath}`);
      }
    }
  }
  return found;
}

// ─── the matrix ───────────────────────────────────────────────────────────────

describe('authz matrix — every mounted /v1 route is covered, and asks the right (resource, key, action)', () => {
  it('the table covers EXACTLY the routes the app mounts (a new route cannot miss a check)', () => {
    const mounted = [...new Set(discoverRoutes())].sort();
    const tabled = [...new Set(MATRIX.map((r) => r.route))].sort();
    expect(mounted.length).toBeGreaterThanOrEqual(24);
    expect(tabled).toEqual(mounted);
  });

  it.each(MATRIX.map((r) => [`${r.route}${r.label ? ` [${r.label}]` : ''}`, r] as const))(
    '%s',
    async (_name, row) => {
      await fire(row);
      expect(selectionListChecks()).toEqual(
        row.checks.map((c) => ({ type: c.type, key: c.key, action: c.action })),
      );
      // Every check is made for the CALLER in the caller's tenant.
      for (const q of asked.filter((x) => x.resource.type === LIST_RES || x.resource.type === CATALOG)) {
        expect(q.subject).toBe(USER);
        expect(q.tenant).toBe(ORG);
      }
    },
  );

  it('tenant-level checks are KEYLESS on the catalog resource; per-list checks always carry the list id', async () => {
    for (const row of MATRIX) {
      asked.length = 0;
      await fire(row);
      for (const q of asked) {
        if (q.resource.type === CATALOG) {
          expect(q.resource).toEqual({ type: CATALOG }); // no key, ever
          expect(['list', 'create', 'read_quota', 'resolve']).toContain(q.action);
        }
        if (q.resource.type === LIST_RES) {
          expect(q.resource.key).toBe(LIST);
          expect(['list', 'create', 'read_quota', 'resolve']).not.toContain(q.action);
        }
      }
    }
  });

  it('NO route asks the per-list `read` / `add_value` action without an instance key (the old tenant-wide reuse)', async () => {
    for (const row of MATRIX) {
      asked.length = 0;
      await fire(row);
      const keyless = asked.filter((q) => q.resource.type === LIST_RES && !q.resource.key);
      expect(keyless).toEqual([]);
    }
  });
});

describe('tenant-level routes — a denied catalog action is a 403 and the handler is never reached', () => {
  const TENANT_ROWS = MATRIX.filter((r) => r.checks[0]?.type === CATALOG);

  it.each(TENANT_ROWS.map((r) => [r.route, r] as const))('%s', async (_n, row) => {
    decide = (q) => q.resource.type !== CATALOG; // per-list actions allowed, catalog denied
    const res = await fire(row);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(db.raw).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each(TENANT_ROWS.map((r) => [r.route, r] as const))(
    '%s: holding EVERY per-list action does not authorize the catalog operation',
    async (_n, row) => {
      decide = (q) => q.resource.type === LIST_RES; // all per-list actions on, catalog off
      const res = await fire(row);
      expect(res.status).toBe(403);
    },
  );

  it.each(TENANT_ROWS.map((r) => [r.route, r] as const))('%s: fails CLOSED when the Security API throws', async (_n, row) => {
    decide = () => new Error('DECISION_UNAVAILABLE');
    const res = await fire(row);
    expect(res.status).toBe(403);
    expect(db.raw).not.toHaveBeenCalled();
  });
});

describe('GET /v1/selection-lists — the catalog `list` action only authorizes asking; each list is filtered by per-list `read`', () => {
  const ROW = (id: string) => ({
    id,
    organization_id: ORG,
    key: id,
    source_locale: 'en',
    status: 'active',
    created_by: USER,
    created_at: new Date('2026-08-10T12:00:00Z'),
    updated_at: new Date('2026-08-10T12:00:00Z'),
    name: id,
    description: null,
    resolved_locale: 'en',
    is_machine: false,
    item_count: '0',
  });
  const A = 'front_sl_01aaaaaaaaaaaaaaaaaaaaaaaa';
  const B = 'front_sl_01bbbbbbbbbbbbbbbbbbbbbbbb';
  const C = 'front_sl_01cccccccccccccccccccccccc';

  it('returns only the lists the caller holds per-list `read` on; the catalog grant alone shows nothing', async () => {
    (db.raw as unknown as jest.Mock).mockResolvedValue({ rows: [ROW(A), ROW(B), ROW(C)] });
    // catalog `list` allowed; per-list read only on B.
    decide = (q) => (q.resource.type === CATALOG ? q.action === 'list' : q.action === 'read' && q.resource.key === B);

    const res = await request(app).get('/v1/selection-lists').set(bearerHeader());

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([B]);
    // One catalog check, then a per-list `read` bulk check for every row on the page.
    expect(asked[0]).toMatchObject({ resource: { type: CATALOG }, action: 'list' });
    const perList = asked.slice(1);
    expect(perList.map((q) => [q.resource.type, q.resource.key, q.action])).toEqual([
      [LIST_RES, A, 'read'],
      [LIST_RES, B, 'read'],
      [LIST_RES, C, 'read'],
    ]);
  });

  it('a member with the catalog grant but no list role sees an EMPTY page (200), not a 403', async () => {
    (db.raw as unknown as jest.Mock).mockResolvedValue({ rows: [ROW(A)] });
    decide = (q) => q.resource.type === CATALOG;
    const res = await request(app).get('/v1/selection-lists').set(bearerHeader());
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('a per-list bulk-check failure fails CLOSED (never "return everything")', async () => {
    (db.raw as unknown as jest.Mock).mockResolvedValue({ rows: [ROW(A)] });
    decide = (q) => (q.resource.type === CATALOG ? true : new Error('bulk-check down'));
    const res = await request(app).get('/v1/selection-lists').set(bearerHeader());
    expect(res.status).toBe(500);
    expect(res.body.items).toBeUndefined();
  });

  it('filterReadable asks the per-list `SelectionList:read` action for each row (not the catalog)', async () => {
    const client = recordingClient();
    _setAuthzClientForTesting(client);
    const req = { userId: USER, orgId: ORG, headers: { authorization: bearerHeader().Authorization } } as any;
    const kept = await filterReadable(req, [{ id: A }, { id: B }]);
    expect(kept.map((r) => r.id)).toEqual([A, B]);
    expect((client.bulkCheck as jest.Mock).mock.calls[0][0]).toEqual([
      { subject: USER, tenant: ORG, resource: { type: LIST_RES, key: A }, action: 'read' },
      { subject: USER, tenant: ORG, resource: { type: LIST_RES, key: B }, action: 'read' },
    ]);
  });
});

describe('item purge needs `delete` on the list (review M-1)', () => {
  const PURGE = MATRIX.find((r) => r.label?.startsWith('purge'))!;
  const ARCHIVE = MATRIX.find((r) => r.label === 'archive (default)')!;

  it('a list-editor (remove_value but not delete) is denied the purge with 403 and nothing is deleted', async () => {
    decide = (q) => q.action === 'remove_value';
    const res = await fire(PURGE);
    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('a list-editor can still ARCHIVE the item (no purge flag -> only remove_value is asked)', async () => {
    decide = (q) => q.action === 'remove_value';
    const res = await fire(ARCHIVE);
    expect(res.status).not.toBe(403);
    expect(selectionListChecks().map((c) => c.action)).toEqual(['remove_value']);
  });

  it('a purge by someone without remove_value is denied at the first check (delete is never reached)', async () => {
    decide = () => false;
    const res = await fire(PURGE);
    expect(res.status).toBe(403);
    expect(selectionListChecks().map((c) => c.action)).toEqual(['remove_value']);
  });

  it('?purge=false is an archive, not a purge', async () => {
    decide = (q) => q.action === 'remove_value';
    const res = await fire({ ...ARCHIVE, query: { purge: 'false' } });
    expect(res.status).not.toBe(403);
  });
});

describe('PATCH list status=archived needs the archive action (review L-1)', () => {
  const ARCHIVING = MATRIX.find((r) => r.label?.startsWith('status=archived'))!;
  const UNARCHIVING = MATRIX.find((r) => r.label?.startsWith('status=active'))!;

  it('a list-editor (update but not delete) cannot archive via PATCH: 403, no write', async () => {
    decide = (q) => q.action === 'update';
    const res = await fire(ARCHIVING);
    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.raw).not.toHaveBeenCalled();
  });

  it('a list-editor can still un-archive / edit via PATCH (only `update` is asked)', async () => {
    decide = (q) => q.action === 'update';
    const res = await fire(UNARCHIVING);
    expect(res.status).not.toBe(403);
    expect(selectionListChecks().map((c) => c.action)).toEqual(['update']);
  });

  it('PATCH and POST /:listId/archive demand the SAME action', async () => {
    await fire(ARCHIVING);
    const patchActions = selectionListChecks().map((c) => c.action);
    asked.length = 0;
    await fire(MATRIX.find((r) => r.route === 'POST /v1/selection-lists/:listId/archive')!);
    expect(patchActions).toContain(selectionListChecks()[0].action); // `delete`
  });
});

describe('per-list routes — a denied per-list action is a 403 (read: 404, no existence oracle) and the handler is not reached', () => {
  const LIST_ROWS = MATRIX.filter((r) => r.checks[0]?.type === LIST_RES);

  it.each(LIST_ROWS.map((r) => [`${r.route}${r.label ? ` [${r.label}]` : ''}`, r] as const))('%s', async (_n, row) => {
    decide = () => false;
    const res = await fire(row);
    expect(res.status).toBe(row.checks[0].action === 'read' ? 404 : 403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('holding the catalog actions does not authorize any per-list route', async () => {
    decide = (q) => q.resource.type === CATALOG; // every catalog action on, every per-list action off
    for (const row of LIST_ROWS) {
      const res = await fire(row);
      expect([403, 404]).toContain(res.status);
    }
  });
});
