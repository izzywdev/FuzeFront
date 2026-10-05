/**
 * Keeps the contract artifacts consistent with each other. Offline: needs no running service.
 *
 * Already gated elsewhere (NOT re-tested here):
 *   - deploy/helm/fuzefront/files/selection-list-service-openapi.yaml is byte-identical to
 *     services/selection-list-service/openapi.yaml -> `gate-mcp-contract`
 *     (scripts/check-mcp-spec-drift.sh).
 *   - every operationId has a client method of the expected NAME ->
 *     scripts/check-selection-lists-client-drift.sh (ci.yml).
 *
 * NOT gated anywhere before this file, and covered here:
 *   1. The client actually issues the HTTP method + path the spec declares for each operation,
 *      sends only declared query parameters, and sends request bodies that validate against the
 *      spec's request schema (a method NAME can exist while calling the wrong route).
 *   2. The spec's `x-permit-resource` / `x-permit-action` / `x-permit-additional-actions` /
 *      `x-permit-shared-read` on all 25 operations equal the authorization matrix (3.0.0, amended
 *      4.0.0 and 4.1.0) in
 *      docs/planning/selection-lists-permit-actions.md §3 (design record) — either side drifting
 *      fails; the spec is normative, so a failure means the document is stale or the spec changed
 *      without the matrix being reviewed.
 *   3. The stand-in Security API the CI authz suites authorize against
 *      (helpers/fake-security-api.mjs) encodes exactly the §4.1 tenant-role and §4.2 instance-role
 *      tables. If it drifted, every authz test would still go green while verifying the wrong
 *      policy.
 */
import fs from 'fs';
import path from 'path';
import { SelectionListClient } from '@fuzeone/selection-list-client';
import { loadSpec, requestBodyErrors } from '../helpers/openapi';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'planning', 'selection-lists-permit-actions.md'), 'utf8');
const FAKE_SRC = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'fake-security-api.mjs'), 'utf8');

type Op = {
  operationId: string;
  parameters?: Array<{ $ref?: string; name?: string; in?: string }>;
  requestBody?: unknown;
  'x-permit-resource'?: string;
  'x-permit-action'?: string;
  'x-permit-additional-actions'?: Array<{ when: string; resource: string; action: string }>;
  'x-permit-shared-read'?: { when: string; resource: string; action: string; predicate: string };
};

function operations(): Array<{ method: string; path: string; op: Op }> {
  const paths = loadSpec()['paths'] as Record<string, Record<string, Op>>;
  const out: Array<{ method: string; path: string; op: Op }> = [];
  for (const [p, item] of Object.entries(paths)) {
    for (const [m, op] of Object.entries(item)) {
      if (op && typeof op === 'object' && op.operationId) out.push({ method: m.toUpperCase(), path: p, op });
    }
  }
  return out;
}

const OPS = operations();

function declaredQueryParams(op: Op, path: string): Set<string> {
  const comps = (loadSpec()['components'] as { parameters?: Record<string, { name: string; in: string }> }).parameters ?? {};
  const pathItem = (loadSpec()['paths'] as Record<string, { parameters?: Op['parameters'] }>)[path];
  const all = [...(pathItem?.parameters ?? []), ...(op.parameters ?? [])];
  const names = new Set<string>();
  for (const p of all) {
    const resolved = p.$ref ? comps[p.$ref.replace('#/components/parameters/', '')] : (p as { name: string; in: string });
    if (resolved?.in === 'query') names.add(resolved.name);
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// 1. the client calls the routes the spec declares
// ---------------------------------------------------------------------------------------------

const L = 'front_sl_01h455vb4pex5vsknk084sn02q';
const I = 'front_sli_01h455vb4pex5vsknk084sn02q';
const U = 'usr_01h455vb4pex5vsknk084sn02q';

type Call = (c: SelectionListClient) => Promise<unknown>;
/** operationId -> how to invoke its client method with representative arguments. */
const DRIVERS: Record<string, { call: Call; queryKeys?: string[] }> = {
  listSelectionLists: { call: (c) => c.getLists({ limit: 5, cursor: 'c', status: 'active', key: 'k', locale: 'en', include_shared: true, visibility: 'org' }), queryKeys: ['limit', 'cursor', 'status', 'key', 'locale', 'include_shared', 'visibility'] },
  createSelectionList: { call: (c) => c.createList({ key: 'my-list', name: 'My list', source_locale: 'en', description: 'd', visibility: 'org' }) },
  forkSelectionList: { call: (c) => c.forkList(L as never, { visibility: 'org' }) },
  getSelectionList: { call: (c) => c.getList(L as never, 'en'), queryKeys: ['locale'] },
  updateSelectionList: { call: (c) => c.updateList(L as never, { name: 'n', description: null, status: 'active', key: 'new-key', source_locale: 'en', visibility: 'private' }) },
  deleteSelectionList: { call: (c) => c.deleteList(L as never, { purge: true }), queryKeys: ['purge'] },
  archiveSelectionList: { call: (c) => c.archiveList(L as never) },
  listSelectionListItems: { call: (c) => c.getItems(L as never, { limit: 5, cursor: 'c', status: 'active', locale: 'en' } as never), queryKeys: ['limit', 'cursor', 'status', 'locale'] },
  createSelectionListItem: { call: (c) => c.createItem(L as never, { code: 'C1', label: 'One', description: 'd', sort_order: 100 }) },
  reorderSelectionListItems: { call: (c) => c.reorderItems(L as never, [I as never]) },
  updateSelectionListItem: { call: (c) => c.updateItem(L as never, I as never, { label: 'x', description: null, sort_order: 1, status: 'archived' }) },
  deleteSelectionListItem: { call: (c) => c.deleteItem(L as never, I as never, { purge: true }), queryKeys: ['purge'] },
  archiveSelectionListItem: { call: (c) => c.archiveItem(L as never, I as never) },
  listSelectionListTranslations: { call: (c) => c.listTranslations(L as never) },
  listSelectionListItemTranslations: { call: (c) => c.listItemTranslations(L as never, I as never) },
  upsertSelectionListTranslation: { call: (c) => c.upsertListTranslation(L as never, 'fr', { name: 'Nom', description: null }) },
  deleteSelectionListTranslation: { call: (c) => c.deleteListTranslation(L as never, 'fr') },
  upsertSelectionListItemTranslation: { call: (c) => c.upsertItemTranslation(L as never, I as never, 'fr', { label: 'Libelle', description: null }) },
  deleteSelectionListItemTranslation: { call: (c) => c.deleteItemTranslation(L as never, I as never, 'fr') },
  autofillSelectionListTranslations: { call: (c) => c.autofillTranslations(L as never, 'fr', {}) },
  listSelectionListAccess: { call: (c) => c.getAccess(L as never, { limit: 5, cursor: 'c' }), queryKeys: ['limit', 'cursor'] },
  setSelectionListAccess: { call: (c) => c.setAccess(L as never, U as never, 'list-viewer') },
  revokeSelectionListAccess: { call: (c) => c.revokeAccess(L as never, U as never) },
  getSelectionListQuota: { call: (c) => c.getQuota() },
  resolveSelectionListItems: { call: (c) => c.resolveIds([I as never], { locale: 'en' }) },
};

function recordingClient(): { client: SelectionListClient; calls: Array<{ method: string; url: URL; body: unknown }> } {
  const calls: Array<{ method: string; url: URL; body: unknown }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url: new URL(String(input)), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { client: new SelectionListClient({ baseUrl: 'http://client.invalid', token: 't', fetch: fakeFetch }), calls };
}

describe('the client issues the routes the spec declares', () => {
  it('has a driver for every operation in the spec (and no stale driver)', () => {
    expect(Object.keys(DRIVERS).sort()).toEqual(OPS.map((o) => o.op.operationId).sort());
    expect(OPS).toHaveLength(25);
  });

  it.each(OPS.map((o) => [o.op.operationId, o.method, o.path] as const))('%s -> %s %s', async (operationId, method, pathTemplate) => {
    const { client, calls } = recordingClient();
    await DRIVERS[operationId].call(client).catch(() => undefined); // the response body is irrelevant; the REQUEST is under test
    expect(calls).toHaveLength(1);
    const call = calls[0];
    const expectedPath = pathTemplate.replace('{listId}', L).replace('{itemId}', I).replace('{userId}', U).replace('{locale}', 'fr');
    expect(call.method).toBe(method);
    expect(decodeURIComponent(call.url.pathname)).toBe(expectedPath);

    const op = OPS.find((o) => o.op.operationId === operationId)!.op;
    // only declared query parameters are sent, and the ones this driver exercises are all sent
    const declared = declaredQueryParams(op, pathTemplate);
    for (const key of call.url.searchParams.keys()) expect(declared.has(key)).toBe(true);
    for (const key of DRIVERS[operationId].queryKeys ?? []) expect(call.url.searchParams.has(key)).toBe(true);

    if (op.requestBody) {
      expect(call.body).toBeDefined();
      expect(requestBodyErrors(method, pathTemplate, call.body)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2. spec x-permit-* == the documented matrix (3.0.0, amended 4.0.0 + 4.1.0)
// ---------------------------------------------------------------------------------------------

function markdownRows(section: RegExp, header: RegExp): string[][] {
  const lines = DOC.split('\n');
  const start = lines.findIndex((l) => section.test(l));
  if (start < 0) throw new Error(`doc section ${section} not found`);
  const h = lines.findIndex((l, i) => i > start && header.test(l));
  if (h < 0) throw new Error(`doc table header ${header} not found`);
  const rows: string[][] = [];
  for (let i = h + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}
const unquote = (s: string): string => s.replace(/`/g, '').trim();

describe('x-permit-* annotations equal the documented authorization matrix', () => {
  const docRows = markdownRows(/^## 3\. /, /^\| operationId /);
  const docMatrix = new Map(docRows.map((r) => [unquote(r[0]), { resource: unquote(r[2]), action: unquote(r[3]), notes: r[4] ?? '' }]));

  it('the document tabulates exactly the spec\'s 25 operations', () => {
    expect([...docMatrix.keys()].sort()).toEqual(OPS.map((o) => o.op.operationId).sort());
  });

  it.each(OPS.map((o) => [o.op.operationId] as const))('%s: resource and action match the matrix', (operationId) => {
    const op = OPS.find((o) => o.op.operationId === operationId)!.op;
    const doc = docMatrix.get(operationId)!;
    expect(op['x-permit-resource']).toBe(doc.resource);
    expect(op['x-permit-action']).toBe(doc.action);
  });

  it('the extra requirements (M-1, L-1, and the 4.1.0 visibility/platform/fork rules) are in the spec exactly where the matrix says', () => {
    const withExtra = OPS.filter((o) => o.op['x-permit-additional-actions']);
    expect(withExtra.map((o) => o.op.operationId).sort()).toEqual([
      'createSelectionList',
      'deleteSelectionList',
      'deleteSelectionListItem',
      'forkSelectionList',
      'updateSelectionList',
    ]);
    const byId = Object.fromEntries(withExtra.map((o) => [o.op.operationId, o.op['x-permit-additional-actions']!]));
    expect(byId['deleteSelectionListItem']).toEqual([
      expect.objectContaining({ when: 'purge=true', resource: 'SelectionList', action: 'delete' }),
      expect.objectContaining({ when: 'purge=true AND list.visibility=platform', resource: 'SelectionListCatalog', action: 'publish_platform' }),
    ]);
    expect(byId['updateSelectionList']).toEqual([
      expect.objectContaining({ when: 'body.status=archived', resource: 'SelectionList', action: 'delete' }),
      expect.objectContaining({ when: 'body.visibility', resource: 'SelectionList', action: 'manage_access' }),
      expect.objectContaining({ when: 'body.visibility=platform', resource: 'SelectionListCatalog', action: 'publish_platform' }),
    ]);
    expect(byId['createSelectionList']).toEqual([
      expect.objectContaining({ when: 'body.visibility=platform', resource: 'SelectionListCatalog', action: 'publish_platform' }),
    ]);
    expect(byId['deleteSelectionList']).toEqual([
      expect.objectContaining({ when: 'purge=true AND list.visibility=platform', resource: 'SelectionListCatalog', action: 'publish_platform' }),
    ]);
    expect(byId['forkSelectionList']).toEqual([expect.objectContaining({ when: 'always', resource: 'SelectionList', action: 'read' })]);
    expect(docMatrix.get('deleteSelectionListItem')!.notes).toMatch(/purge=true.*delete/);
    expect(docMatrix.get('deleteSelectionListItem')!.notes).toMatch(/platform.*publish_platform/);
    expect(docMatrix.get('updateSelectionList')!.notes).toMatch(/status: archived.*delete/);
    expect(docMatrix.get('updateSelectionList')!.notes).toMatch(/visibility.*manage_access/);
    expect(docMatrix.get('updateSelectionList')!.notes).toMatch(/platform.*publish_platform/);
    expect(docMatrix.get('createSelectionList')!.notes).toMatch(/platform.*publish_platform/);
    expect(docMatrix.get('deleteSelectionList')!.notes).toMatch(/platform.*publish_platform/);
    expect(docMatrix.get('forkSelectionList')!.notes).toMatch(/read/);
  });

  it('every tenant-scoped (keyless) operation uses SelectionListCatalog and every per-list operation SelectionList', () => {
    const catalog = OPS.filter((o) => o.op['x-permit-resource'] === 'SelectionListCatalog').map((o) => o.op.operationId).sort();
    // forkSelectionList (4.1.0) is addressed by a source list id but CREATES a list in the caller's
    // org, so its base check is the catalog `create`; the source read is an additional action.
    expect(catalog).toEqual(['createSelectionList', 'forkSelectionList', 'getSelectionListQuota', 'listSelectionLists', 'resolveSelectionListItems']);
    for (const o of OPS) expect(['SelectionList', 'SelectionListCatalog']).toContain(o.op['x-permit-resource']);
  });

  it('the shared read (4.1.0) is declared on exactly the read operations, always as SelectionListCatalog:read_shared', () => {
    const shared = OPS.filter((o) => o.op['x-permit-shared-read']).map((o) => o.op.operationId).sort();
    expect(shared).toEqual([
      'forkSelectionList',
      'getSelectionList',
      'listSelectionListItemTranslations',
      'listSelectionListItems',
      'listSelectionListTranslations',
      'listSelectionLists',
    ]);
    for (const o of OPS.filter((x) => x.op['x-permit-shared-read'])) {
      expect(o.op['x-permit-shared-read']).toEqual(expect.objectContaining({ resource: 'SelectionListCatalog', action: 'read_shared' }));
      // shared read only ever widens a READ: the base action is `read` (or a catalog read/create).
      expect(['read', 'list', 'create']).toContain(o.op['x-permit-action']);
    }
    // ...and no mutation carries it.
    for (const o of OPS.filter((x) => !x.op['x-permit-shared-read'] && x.op['x-permit-resource'] === 'SelectionList')) {
      expect(o.op['x-permit-action']).not.toBe('read');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3. the CI stand-in Security API encodes the documented policy
// ---------------------------------------------------------------------------------------------

function fakeConst(name: string): Record<string, string[]> {
  // Plain string search (no dynamic RegExp): the object literal runs from `const NAME = {` to the
  // first line that is exactly `};`.
  const head = `const ${name} = {`;
  const start = FAKE_SRC.indexOf(head);
  const end = start < 0 ? -1 : FAKE_SRC.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error(`const ${name} not found in helpers/fake-security-api.mjs`);
  const literal = FAKE_SRC.slice(start + head.length - 1, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${literal});`)() as Record<string, string[]>;
}

describe('helpers/fake-security-api.mjs implements the documented policy (so the authz suites verify the real contract)', () => {
  it('tenant roles carry exactly the §4.1 SelectionListCatalog actions — and no SelectionList:* action', () => {
    const rows = markdownRows(/^### 4\.1 /, /^\| tenant role /);
    const header = DOC.split('\n').find((l) => /^\| tenant role /.test(l))!.split('|').slice(2, -1).map((c) => unquote(c));
    const expected: Record<string, string[]> = {};
    for (const r of rows) expected[unquote(r[0])] = header.filter((_a, i) => r[i + 1] === 'x');
    const actual = fakeConst('TENANT_ROLE_ACTIONS');
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const role of Object.keys(expected)) expect([...actual[role]].sort()).toEqual([...expected[role]].sort());
    const perListActions = new Set(Object.values(fakeConst('ROLE_ACTIONS')).flat());
    for (const acts of Object.values(actual)) for (const a of acts) expect(perListActions.has(a)).toBe(false);
  });

  it('instance roles carry exactly the §4.2 per-list actions', () => {
    const rows = markdownRows(/^### 4\.2 /, /^\| role /);
    const header = DOC.split('\n').find((l) => /^\| role \|/.test(l))!.split('|').slice(2, -1).map((c) => unquote(c));
    const expected: Record<string, string[]> = {};
    for (const r of rows) expected[unquote(r[0])] = header.filter((_a, i) => r[i + 1] === 'x');
    const actual = fakeConst('ROLE_ACTIONS');
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const role of Object.keys(expected)) expect([...actual[role]].sort()).toEqual([...expected[role]].sort());
  });

  it('the spec only references actions the instance-role / tenant-role tables define', () => {
    const defined = new Set(Object.values(fakeConst('ROLE_ACTIONS')).flat());
    const catalogActions = new Set(Object.values(fakeConst('TENANT_ROLE_ACTIONS')).flat());
    const setFor = (resource: string | undefined): Set<string> => (resource === 'SelectionListCatalog' ? catalogActions : defined);
    for (const o of OPS) {
      expect(setFor(o.op['x-permit-resource']).has(o.op['x-permit-action']!)).toBe(true);
      for (const extra of o.op['x-permit-additional-actions'] ?? []) expect(setFor(extra.resource).has(extra.action)).toBe(true);
      const sr = o.op['x-permit-shared-read'];
      if (sr) expect(setFor(sr.resource).has(sr.action)).toBe(true);
    }
  });
});
