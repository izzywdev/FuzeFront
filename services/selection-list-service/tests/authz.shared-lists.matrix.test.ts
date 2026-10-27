// authz.shared-lists.matrix.test.ts — every `x-permit-additional-actions` row and every `x-permit-shared-read`
// declaration of openapi.yaml 4.1.0 is ENFORCED by the service and pinned here (design record task 5).
//
// Two halves:
//   1. SPEC <-> TABLE. The rows the spec declares are read from openapi.yaml and compared with the table
//      below, so a row added to (or dropped from) the spec without being implemented and pinned fails here.
//   2. TABLE <-> SERVICE. Each table row drives the real app (real Postgres, scriptable Security API) and
//      asserts the exact ordered (resource, action) decisions the route asked for, and in which tenant: the
//      platform-only act is asked in the PLATFORM tenant.

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { createWorld, P, PLATFORM, publishPriorityList, World } from './helpers/sharedWorld';
import { permitKey } from './helpers/ids';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const SPEC = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8')) as any;

/** `operationId|when|Resource:action` for every declared additional action. */
function specRows(): string[] {
  const out: string[] = [];
  for (const item of Object.values<any>(SPEC.paths)) {
    for (const op of Object.values<any>(item)) {
      for (const r of op?.['x-permit-additional-actions'] ?? []) out.push(`${op.operationId}|${r.when}|${r.resource}:${r.action}`);
    }
  }
  return out.sort();
}
function specSharedRead(): string[] {
  const out: string[] = [];
  for (const item of Object.values<any>(SPEC.paths)) {
    for (const op of Object.values<any>(item)) {
      if (op?.['x-permit-shared-read']) out.push(`${op.operationId}|${op['x-permit-shared-read'].action}`);
    }
  }
  return out.sort();
}

// What the service enforces (the spec rows, 1:1).
const ENFORCED_ROWS = [
  'createSelectionList|body.visibility=platform|SelectionListCatalog:publish_platform',
  'updateSelectionList|body.status=archived|SelectionList:delete',
  'updateSelectionList|body.visibility|SelectionList:manage_access',
  'updateSelectionList|body.visibility=platform|SelectionListCatalog:publish_platform',
  'deleteSelectionList|purge=true AND list.visibility=platform|SelectionListCatalog:publish_platform',
  'deleteSelectionListItem|purge=true|SelectionList:delete',
  'deleteSelectionListItem|purge=true AND list.visibility=platform|SelectionListCatalog:publish_platform',
  'forkSelectionList|always|SelectionList:read',
].sort();
const ENFORCED_SHARED_READ = [
  'getSelectionList|read_shared',
  'forkSelectionList|read_shared',
  'listSelectionLists|read_shared',
  'listSelectionListItems|read_shared',
  'listSelectionListTranslations|read_shared',
  'listSelectionListItemTranslations|read_shared',
].sort();

describe('spec <-> implementation table', () => {
  it('every x-permit-additional-actions row of the 4.1.0 contract is in the enforced table, and vice versa', () => {
    expect(specRows()).toEqual(ENFORCED_ROWS);
  });
  it('every x-permit-shared-read declaration of the contract is in the enforced table, and vice versa', () => {
    expect(specSharedRead()).toEqual(ENFORCED_SHARED_READ);
  });
});

dbDescribe('x-permit-additional-actions / x-permit-shared-read are enforced (real Postgres)', () => {
  let w: World;
  let c: { listId: string; low: string };
  let priv: string;

  beforeAll(async () => {
    w = await createWorld(state);
    const p = await publishPriorityList(w);
    c = { listId: p.listId, low: p.low };
    priv = (await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'm-private', name: 'M' })).body.id;
  });
  afterAll(() => w.teardown());

  /** Run `fn`, return the ordered decisions it caused as `type:action`, plus the last query's tenant. */
  async function asked(fn: () => Promise<any>): Promise<{ checks: string[]; res: any; lastTenant?: string }> {
    const mark = w.authz.asked.length;
    const res = await fn();
    return { checks: w.authz.since(mark), res, lastTenant: w.authz.asked.slice(mark).pop()?.tenant };
  }

  it('createSelectionList body.visibility=platform -> create, then publish_platform in the PLATFORM tenant', async () => {
    const r = await asked(() => w.api(P.op).post('/v1/selection-lists', { key: 'mx-1', name: 'M', visibility: 'platform' }));
    expect(r.res.status).toBe(201);
    expect(r.checks).toEqual(['catalog:create', 'catalog:publish_platform']);
    expect(r.lastTenant).toBe(permitKey(PLATFORM));
    // not asked for org / private / absent
    for (const visibility of ['org', 'private', undefined]) {
      const o = await asked(() => w.api(P.aAdmin).post('/v1/selection-lists', { key: `mx-${visibility}`, name: 'M', ...(visibility ? { visibility } : {}) }));
      expect(o.res.status).toBe(201);
      expect(o.checks).toEqual(['catalog:create']);
    }
  });

  it('updateSelectionList: archive -> update+delete; visibility -> update+manage_access; platform -> +publish_platform', async () => {
    const mk = async (key: string) => (await w.api(P.aAdmin).post('/v1/selection-lists', { key, name: key })).body.id as string;
    const a = await mk('mx-arch');
    expect((await asked(() => w.api(P.aAdmin).patch(`/v1/selection-lists/${a}`, { status: 'archived' }))).checks).toEqual(['list:update', 'list:delete']);
    expect((await asked(() => w.api(P.aAdmin).patch(`/v1/selection-lists/${a}`, { status: 'active' }))).checks).toEqual(['list:update']);
    expect((await asked(() => w.api(P.aAdmin).patch(`/v1/selection-lists/${a}`, { visibility: 'org' }))).checks).toEqual(['list:update', 'list:manage_access']);
    expect((await asked(() => w.api(P.aAdmin).patch(`/v1/selection-lists/${a}`, { name: 'plain' }))).checks).toEqual(['list:update']);
    expect((await asked(() => w.api(P.aAdmin).patch(`/v1/selection-lists/${a}`, { status: 'archived', visibility: 'private' }))).checks)
      .toEqual(['list:update', 'list:delete', 'list:manage_access']);
    const o = await mk2(P.op, 'mx-promote');
    const promote = await asked(() => w.api(P.op).patch(`/v1/selection-lists/${o}`, { visibility: 'platform' }));
    expect(promote.checks).toEqual(['list:update', 'list:manage_access', 'catalog:publish_platform']);
    expect(promote.lastTenant).toBe(permitKey(PLATFORM));
    async function mk2(p: typeof P.op, key: string) {
      return (await w.api(p).post('/v1/selection-lists', { key, name: key })).body.id as string;
    }
  });

  it('deleteSelectionList: purge of a platform list -> delete + publish_platform; archive / private purge -> delete only', async () => {
    const mkc = async (key: string) => (await w.api(P.op).post('/v1/selection-lists', { key, name: key, visibility: 'platform' })).body.id as string;
    const one = await mkc('mx-purge-1');
    const archive = await asked(() => w.api(P.op).del(`/v1/selection-lists/${one}`));
    expect(archive.checks).toEqual(['list:delete']);
    const purge = await asked(() => w.api(P.op).del(`/v1/selection-lists/${one}?purge=true`));
    expect(purge.res.status).toBe(204);
    expect(purge.checks).toEqual(['list:delete', 'catalog:publish_platform']);
    expect(purge.lastTenant).toBe(permitKey(PLATFORM));
    const p = await asked(() => w.api(P.aAdmin).del(`/v1/selection-lists/${priv}?purge=true`));
    expect(p.res.status).toBe(204);
    expect(p.checks).toEqual(['list:delete']);
    priv = (await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'm-private', name: 'M' })).body.id;
  });

  it('deleteSelectionListItem: purge -> remove_value + delete (+ publish_platform on a platform list); archive -> remove_value', async () => {
    const mkItem = async (p: typeof P.op, listId: string, code: string) => (await w.api(p).post(`/v1/selection-lists/${listId}/items`, { code, label: code })).body.id as string;
    const pi = await mkItem(P.aAdmin, priv, 'PI');
    expect((await asked(() => w.api(P.aAdmin).del(`/v1/selection-lists/${priv}/items/${pi}`))).checks).toEqual(['list:remove_value']);
    const purgePrivate = await asked(() => w.api(P.aAdmin).del(`/v1/selection-lists/${priv}/items/${pi}?purge=true`));
    expect(purgePrivate.res.status).toBe(204);
    expect(purgePrivate.checks).toEqual(['list:remove_value', 'list:delete']);
    const ci = await mkItem(P.op, c.listId, 'CI');
    const purgeCommon = await asked(() => w.api(P.op).del(`/v1/selection-lists/${c.listId}/items/${ci}?purge=true`));
    expect(purgeCommon.res.status).toBe(204);
    expect(purgeCommon.checks).toEqual(['list:remove_value', 'list:delete', 'catalog:publish_platform']);
    expect(purgeCommon.lastTenant).toBe(permitKey(PLATFORM));
  });

  it('forkSelectionList -> create (catalog) + the source read (shared read, memoised once)', async () => {
    const r = await asked(() => w.api(P.aMember).post(`/v1/selection-lists/${c.listId}/fork`, {}));
    expect(r.res.status).toBe(201);
    expect(r.checks).toEqual(['catalog:create', 'catalog:read_shared']);
  });

  it('the shared-read operations ask read_shared (catalog, caller tenant) — once — for a common list', async () => {
    const cases: Array<[string, () => Promise<any>]> = [
      ['getSelectionList', () => w.api(P.bMember).get(`/v1/selection-lists/${c.listId}`)],
      ['listSelectionListItems', () => w.api(P.bMember).get(`/v1/selection-lists/${c.listId}/items`)],
      ['listSelectionListTranslations', () => w.api(P.bMember).get(`/v1/selection-lists/${c.listId}/translations`)],
      ['listSelectionListItemTranslations', () => w.api(P.bMember).get(`/v1/selection-lists/${c.listId}/items/${c.low}/translations`)],
    ];
    for (const [name, call] of cases) {
      const r = await asked(call);
      expect({ name, status: r.res.status, checks: r.checks }).toEqual({ name, status: 200, checks: ['catalog:read_shared'] });
    }
    const list = await asked(() => w.api(P.bMember).get('/v1/selection-lists?include_shared=true'));
    expect(list.checks).toEqual(['catalog:list', 'catalog:read_shared']);
    // without include_shared the shared read is NOT asked
    const plain = await asked(() => w.api(P.bMember).get('/v1/selection-lists'));
    expect(plain.checks).toEqual(['catalog:list']);
  });
});
