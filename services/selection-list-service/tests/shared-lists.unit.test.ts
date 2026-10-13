// shared-lists.unit.test.ts — the pure parts of lib/sharedLists.ts (no database, no HTTP): org id renderings,
// the shared-read data predicate, the platform-organization resolution and its boot check, the per-request
// memo, and the data contract file.

import fs from 'fs';
import path from 'path';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import {
  _resetPlatformOrgCacheForTesting,
  canonicalOrgId,
  configuredPlatformOrgId,
  memoPerRequest,
  orgForms,
  PLATFORM_ORG_ENV,
  PlatformOrgConfigError,
  resolvePlatformOrgId,
  sameOrg,
  sharedPredicate,
  verifyPlatformOrgConfig,
} from '../src/lib/sharedLists';
import { PRODUCED_TOPICS } from '../src/events/outbox';
import { loadSchema } from './helpers/schema';

const UUID = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e00';
const PLATFORM = fromUuid('organization', UUID);
const OTHER = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e0a');

/** A knex-ish executor whose `raw` answers from a script of (sql-matcher -> rows). */
function exec(rows: Record<string, unknown[]>) {
  const calls: string[] = [];
  return {
    calls,
    raw: jest.fn(async (sql: string) => {
      calls.push(sql);
      const hit = Object.keys(rows).find((k) => sql.includes(k));
      return { rows: hit ? rows[hit] : [] };
    }),
  } as any;
}

describe('org id renderings', () => {
  it('canonicalises a TypeID or bare UUID to the TypeID; anything else is null', () => {
    expect(canonicalOrgId(PLATFORM)).toBe(PLATFORM);
    expect(canonicalOrgId(UUID.toUpperCase())).toBe(PLATFORM);
    expect(canonicalOrgId('acme')).toBeNull();
    expect(canonicalOrgId(null)).toBeNull();
  });

  it('sameOrg compares renderings of one org, never two different orgs, and never an unknown value to itself loosely', () => {
    expect(sameOrg(PLATFORM, UUID)).toBe(true);
    expect(sameOrg(PLATFORM, OTHER)).toBe(false);
    expect(sameOrg('acme', 'acme')).toBe(true); // identical strings are identical
    expect(sameOrg('acme', 'acme2')).toBe(false);
    expect(sameOrg(undefined, PLATFORM)).toBe(false);
  });

  it('orgForms lists the TypeID and the bare UUID', () => {
    expect(orgForms(PLATFORM).sort()).toEqual([PLATFORM, UUID].sort());
    expect(orgForms('org_notatypeid')).toEqual(['org_notatypeid']); // not codec-valid: literal only
  });
});

describe('sharedPredicate — the service-owned half of readable(L, C)', () => {
  it('private: never; org: only the owning org; platform: only a row owned by the platform org', () => {
    expect(sharedPredicate({ organization_id: OTHER, visibility: 'private' }, OTHER, PLATFORM)).toBe(false);
    expect(sharedPredicate({ organization_id: OTHER, visibility: null }, OTHER, PLATFORM)).toBe(false);
    expect(sharedPredicate({ organization_id: OTHER, visibility: 'org' }, OTHER, PLATFORM)).toBe(true);
    expect(sharedPredicate({ organization_id: OTHER, visibility: 'org' }, PLATFORM, PLATFORM)).toBe(false);
    expect(sharedPredicate({ organization_id: PLATFORM, visibility: 'platform' }, OTHER, PLATFORM)).toBe(true);
    expect(sharedPredicate({ organization_id: UUID, visibility: 'platform' }, OTHER, PLATFORM)).toBe(true); // other rendering of the platform org
  });

  it('a platform row NOT owned by the platform org, or with no platform org resolved, is not served (fail closed)', () => {
    expect(sharedPredicate({ organization_id: OTHER, visibility: 'platform' }, PLATFORM, PLATFORM)).toBe(false);
    expect(sharedPredicate({ organization_id: PLATFORM, visibility: 'platform' }, OTHER, null)).toBe(false);
  });
});

describe('memoPerRequest', () => {
  it('runs once per (request, key), also for a rejection; a different request or key runs again', async () => {
    const req = {};
    const fn = jest.fn(async () => 1);
    await Promise.all([memoPerRequest(req, 'k', fn), memoPerRequest(req, 'k', fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    await memoPerRequest(req, 'other', fn);
    await memoPerRequest({}, 'k', fn);
    expect(fn).toHaveBeenCalledTimes(3);
    const boom = jest.fn(async () => {
      throw new Error('x');
    });
    await expect(memoPerRequest(req, 'b', boom)).rejects.toThrow('x');
    await expect(memoPerRequest(req, 'b', boom)).rejects.toThrow('x');
    expect(boom).toHaveBeenCalledTimes(1);
  });
});

describe('platform organization resolution', () => {
  const ENV = process.env[PLATFORM_ORG_ENV];
  beforeEach(() => {
    delete process.env[PLATFORM_ORG_ENV];
    _resetPlatformOrgCacheForTesting();
  });
  afterAll(() => {
    if (ENV === undefined) delete process.env[PLATFORM_ORG_ENV];
    else process.env[PLATFORM_ORG_ENV] = ENV;
    _resetPlatformOrgCacheForTesting();
  });

  it('configuredPlatformOrgId accepts only an org_ TypeID', () => {
    expect(configuredPlatformOrgId({ [PLATFORM_ORG_ENV]: PLATFORM })).toBe(PLATFORM);
    expect(configuredPlatformOrgId({ [PLATFORM_ORG_ENV]: ` ${PLATFORM} ` })).toBe(PLATFORM);
    expect(configuredPlatformOrgId({ [PLATFORM_ORG_ENV]: UUID })).toBeNull();
    expect(configuredPlatformOrgId({ [PLATFORM_ORG_ENV]: 'usr_abc' })).toBeNull();
    expect(configuredPlatformOrgId({})).toBeNull();
  });

  it('configured and not contradicted (no projection row / a platform row): resolves', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    expect(await resolvePlatformOrgId(exec({}))).toBe(PLATFORM);
    _resetPlatformOrgCacheForTesting();
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', wire_id: PLATFORM }] }))).toBe(PLATFORM);
  });

  it('configured but the projection says it is an ordinary or a deleted org: fails closed (null)', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: 'organization', status: 'active', wire_id: PLATFORM }] }))).toBeNull();
    _resetPlatformOrgCacheForTesting();
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'deleted', wire_id: PLATFORM }] }))).toBeNull();
  });

  it('unset: the single active platform org of the projection; none or several: null', async () => {
    expect(await resolvePlatformOrgId(exec({ "org_type = 'platform'": [{ org_type: 'platform', status: 'active', wire_id: PLATFORM }] }))).toBe(PLATFORM);
    _resetPlatformOrgCacheForTesting();
    expect(await resolvePlatformOrgId(exec({}))).toBeNull();
    _resetPlatformOrgCacheForTesting();
    const two = [{ wire_id: PLATFORM }, { wire_id: OTHER }];
    expect(await resolvePlatformOrgId(exec({ "org_type = 'platform'": two }))).toBeNull();
  });

  it('caches for a short TTL (one lookup), and does not cache a database failure', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    const e = exec({});
    await resolvePlatformOrgId(e, 1_000);
    await resolvePlatformOrgId(e, 2_000);
    expect(e.raw).toHaveBeenCalledTimes(1);
    await resolvePlatformOrgId(e, 1_000 + 31_000);
    expect(e.raw).toHaveBeenCalledTimes(2);

    _resetPlatformOrgCacheForTesting();
    const failing: any = { raw: jest.fn(async () => { throw new Error('db down'); }) };
    expect(await resolvePlatformOrgId(failing)).toBeNull();
    expect(await resolvePlatformOrgId(failing)).toBeNull();
    expect(failing.raw).toHaveBeenCalledTimes(2); // retried, not cached
  });
});

describe('verifyPlatformOrgConfig — the boot check', () => {
  it('unset: allowed (the projection is the fallback)', async () => {
    expect(await verifyPlatformOrgConfig(exec({}), {})).toBe('unset');
  });

  it('set to something that is not an org_ TypeID: refuses to start', async () => {
    await expect(verifyPlatformOrgConfig(exec({}), { [PLATFORM_ORG_ENV]: UUID })).rejects.toBeInstanceOf(PlatformOrgConfigError);
    await expect(verifyPlatformOrgConfig(exec({}), { [PLATFORM_ORG_ENV]: 'usr_abc' })).rejects.toBeInstanceOf(PlatformOrgConfigError);
  });

  it('set and the projection says it is a platform org: confirmed', async () => {
    const e = exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', wire_id: PLATFORM }] });
    expect(await verifyPlatformOrgConfig(e, { [PLATFORM_ORG_ENV]: PLATFORM })).toBe('confirmed');
  });

  it('set and the projection CONTRADICTS it (ordinary org, personal org, deleted): refuses to start', async () => {
    for (const row of [
      { org_type: 'organization', status: 'active' },
      { org_type: 'personal', status: 'active' },
      { org_type: 'platform', status: 'deleted' },
    ]) {
      await expect(verifyPlatformOrgConfig(exec({ 'wire_id = ?': [{ ...row, wire_id: PLATFORM }] }), { [PLATFORM_ORG_ENV]: PLATFORM })).rejects.toBeInstanceOf(PlatformOrgConfigError);
    }
  });

  it('set but not (yet) in the projection, or without a type: accepted but unconfirmed', async () => {
    expect(await verifyPlatformOrgConfig(exec({}), { [PLATFORM_ORG_ENV]: PLATFORM })).toBe('unconfirmed');
    const untyped = exec({ 'wire_id = ?': [{ org_type: null, status: 'active', wire_id: PLATFORM }] });
    expect(await verifyPlatformOrgConfig(untyped, { [PLATFORM_ORG_ENV]: PLATFORM })).toBe('unconfirmed');
  });
});

describe('data-contract.json (data-consistency standard)', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data-contract.json'), 'utf8'));

  it('emits exactly the topics the outbox may produce', () => {
    expect([...contract.emits].sort()).toEqual([...PRODUCED_TOPICS].sort());
  });

  it('declares the 4.1.0 provenance references with the on-delete policy "retain" (a dangling provenance id is legal)', () => {
    const byColumn = Object.fromEntries(contract.references.map((r: any) => [r.column, r]));
    for (const [column, targetType] of [
      ['selection_lists.forked_from_list_id', 'front_sl'],
      ['selection_lists.forked_from_org_id', 'org'],
      ['selection_list_items.origin_item_id', 'front_sli'],
    ]) {
      expect(byColumn[column]).toMatchObject({ targetType, onDelete: 'retain', validation: 'L1' });
    }
  });

  it('every declared reference column exists in the migrations', () => {
    const schema = loadSchema();
    for (const r of contract.references) {
      const [table, column] = r.column.split('.');
      expect({ column: r.column, exists: schema[table]?.has(column) }).toEqual({ column: r.column, exists: true });
    }
  });
});
