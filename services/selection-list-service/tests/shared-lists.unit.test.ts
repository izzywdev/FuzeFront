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
  ROOT_PLATFORM_ORG_WIRE,
  sharedPredicate,
  verifyPlatformOrgConfig,
  parseConfiguredPlatformOrg,
} from '../src/lib/sharedLists';
import { readableByOrg } from '../src/services/sharedReads';
import { orgRenderings } from '../src/lib/sharedLists';
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

describe('readableByOrg - SQL shape', () => {
  it('an empty alias emits UNQUALIFIED column names (no ".organization_id", no quoted empty identifier)', () => {
    for (const platformOrg of [null, PLATFORM]) {
      const q = readableByOrg('', OTHER, { shared: true, platformOrg });
      expect(q.sql).not.toMatch(/\.|"/);
      expect(q.sql).toMatch(/^\(?organization_id = (\?|ANY\(\?\))/);
    }
    expect(readableByOrg('', OTHER, { shared: false, platformOrg: null })).toEqual({ sql: 'organization_id = ?', params: [OTHER] });
  });
  it('a real alias qualifies every column', () => {
    const q = readableByOrg('sl', OTHER, { shared: true, platformOrg: PLATFORM });
    expect(q.sql).toBe("(sl.organization_id = ANY(?) OR (sl.visibility = 'platform' AND sl.organization_id = ANY(?)))");
    expect(q.params).toEqual([orgRenderings(OTHER), orgForms(PLATFORM)]);
  });
});

describe('readableByOrg - the default listing (includePlatform: false)', () => {
  it('feature on: the org\'s own rows across EVERY rendering, no platform branch', () => {
    const q = readableByOrg('sl', UUID, { shared: true, platformOrg: PLATFORM, includePlatform: false });
    expect(q.sql).toBe('sl.organization_id = ANY(?)');
    expect((q.params[0] as string[]).sort()).toEqual([PLATFORM, UUID].sort());
  });
  it('feature off: the 4.0.0 exact match, whatever includePlatform says', () => {
    expect(readableByOrg('sl', UUID, { shared: false, platformOrg: null, includePlatform: false })).toEqual({ sql: 'sl.organization_id = ?', params: [UUID] });
    expect(readableByOrg('sl', UUID, { shared: false, platformOrg: PLATFORM })).toEqual({ sql: 'sl.organization_id = ?', params: [UUID] });
  });
  it('feature ON but the platform org UNRESOLVED: the own org still matches under every rendering; no platform branch', () => {
    for (const includePlatform of [true, false, undefined]) {
      const q = readableByOrg('sl', UUID, { shared: true, platformOrg: null, includePlatform });
      expect(q.sql).toBe('sl.organization_id = ANY(?)');
      expect((q.params[0] as string[]).sort()).toEqual([PLATFORM, UUID].sort());
    }
  });
});

describe('orgRenderings - the one canonical helper', () => {
  it('lists the claim as presented plus its TypeID and bare UUID, once each', () => {
    expect(orgRenderings(PLATFORM).sort()).toEqual([PLATFORM, UUID].sort());
    expect(orgRenderings(UUID).sort()).toEqual([PLATFORM, UUID].sort());
    expect(orgRenderings('acme')).toEqual(['acme']);
  });
  it('the shared read scope and the shared predicate use it (either rendering of the same org matches)', () => {
    expect(readableByOrg('sl', UUID, { shared: true, platformOrg: OTHER }).params[0].sort()).toEqual([PLATFORM, UUID].sort());
    expect(sharedPredicate({ organization_id: PLATFORM, visibility: 'org' }, UUID, null)).toBe(true);
    expect(sharedPredicate({ organization_id: UUID, visibility: 'org' }, PLATFORM, null)).toBe(true);
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

  it('configured AND confirmed by the projection (active, org_type platform): resolves', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', is_active: true, wire_id: PLATFORM }] }))).toBe(PLATFORM);
  });

  it('configured but NOT confirmed (no projection row, or no type yet): unresolved => null, fail closed', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    expect(await resolvePlatformOrgId(exec({}))).toBeNull();
    _resetPlatformOrgCacheForTesting();
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: null, status: 'active', is_active: true, wire_id: PLATFORM }] }))).toBeNull();
  });

  it('a DEACTIVATED configured platform org (is_active=false, status still active) is unresolved: features disabled', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', is_active: false, wire_id: PLATFORM }] }))).toBeNull();
    _resetPlatformOrgCacheForTesting();
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', is_active: null, wire_id: PLATFORM }] }))).toBeNull();
  });

  it('an UNRESOLVED answer is cached only briefly (5 s) and so is a confirmed one (explicitly invalidated on projection writes)', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    const pending = exec({});
    await resolvePlatformOrgId(pending, 1_000);
    await resolvePlatformOrgId(pending, 3_000);
    expect(pending.raw).toHaveBeenCalledTimes(1);
    const confirmed = exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', is_active: true, wire_id: PLATFORM }] });
    expect(await resolvePlatformOrgId(confirmed, 1_000 + 6_000)).toBe(PLATFORM); // negative entry expired after 5 s
    await resolvePlatformOrgId(confirmed, 1_000 + 6_000 + 4_999);
    expect(confirmed.raw).toHaveBeenCalledTimes(1); // inside the 5 s window
    await resolvePlatformOrgId(confirmed, 1_000 + 6_000 + 5_000);
    expect(confirmed.raw).toHaveBeenCalledTimes(2); // window closed: re-read
  });

  it('configured but the projection says it is an ordinary or a deleted org: fails closed (null)', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: 'organization', status: 'active', wire_id: PLATFORM }] }))).toBeNull();
    _resetPlatformOrgCacheForTesting();
    expect(await resolvePlatformOrgId(exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'deleted', wire_id: PLATFORM }] }))).toBeNull();
  });

  it('unset: ALWAYS null — the projection is never a source of the platform org (its org_type is user-controllable)', async () => {
    // a projection full of rows typed 'platform' (anyone can create such an org) must not be consulted at all
    const e = exec({ "org_type = 'platform'": [{ org_type: 'platform', status: 'active', wire_id: OTHER }], 'wire_id': [{ org_type: 'platform', status: 'active', wire_id: OTHER }] });
    expect(await resolvePlatformOrgId(e)).toBeNull();
    expect(e.raw).not.toHaveBeenCalled();
  });

  it('caches for a short TTL (one lookup), and does not cache a database failure', async () => {
    process.env[PLATFORM_ORG_ENV] = PLATFORM;
    const e = exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', is_active: true, wire_id: PLATFORM }] });
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
  it('the root platform org TypeID is the encoding of ROOT_ORG_ID; any other configured value is accepted (configurable)', async () => {
    expect(ROOT_PLATFORM_ORG_WIRE).toBe(fromUuid('organization', '00000000-0000-0000-0000-000000000010'));
    const e = exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', is_active: true, wire_id: PLATFORM }] });
    expect(await verifyPlatformOrgConfig(e, { [PLATFORM_ORG_ENV]: PLATFORM })).toBe('confirmed');
  });

  it('unset: allowed, platform features are disabled (no projection fallback)', async () => {
    expect(await verifyPlatformOrgConfig(exec({}), {})).toBe('unset');
  });

  it('set to something that is not an org_ TypeID: refuses to start', async () => {
    await expect(verifyPlatformOrgConfig(exec({}), { [PLATFORM_ORG_ENV]: UUID })).rejects.toBeInstanceOf(PlatformOrgConfigError);
    await expect(verifyPlatformOrgConfig(exec({}), { [PLATFORM_ORG_ENV]: 'usr_abc' })).rejects.toBeInstanceOf(PlatformOrgConfigError);
    // looks like an org TypeID, but the identity codec cannot decode it: FATAL, not "no projection row yet"
    for (const bad of ['org_notatypeid', 'org_' + 'z'.repeat(26), 'org_01jpmf4z1yf88rpb9z9sd6pzgZ', 'org_0', 'org_' + 'a'.repeat(300)]) {
      await expect(verifyPlatformOrgConfig(exec({}), { [PLATFORM_ORG_ENV]: bad })).rejects.toBeInstanceOf(PlatformOrgConfigError);
      expect(configuredPlatformOrgId({ [PLATFORM_ORG_ENV]: bad })).toBeNull(); // every runtime reader sees "not configured"
      expect(() => parseConfiguredPlatformOrg({ [PLATFORM_ORG_ENV]: bad })).toThrow(PlatformOrgConfigError);
    }
    // a non-canonical spelling of a valid id is not accepted either
    expect(configuredPlatformOrgId({ [PLATFORM_ORG_ENV]: PLATFORM.toUpperCase() })).toBeNull();
    // valid, unprojected: still the documented asynchronous state
    expect(configuredPlatformOrgId({ [PLATFORM_ORG_ENV]: PLATFORM })).toBe(PLATFORM);
    expect(configuredPlatformOrgId({ [PLATFORM_ORG_ENV]: ROOT_PLATFORM_ORG_WIRE })).toBe(ROOT_PLATFORM_ORG_WIRE);
  });

  it('set and the projection says it is a platform org: confirmed', async () => {
    const e = exec({ 'wire_id = ?': [{ org_type: 'platform', status: 'active', is_active: true, wire_id: PLATFORM }] });
    expect(await verifyPlatformOrgConfig(e, { [PLATFORM_ORG_ENV]: PLATFORM })).toBe('confirmed');
  });

  it('set and the projection CONTRADICTS it (ordinary org, personal org, deleted): refuses to start', async () => {
    for (const row of [
      { org_type: 'organization', status: 'active', is_active: true },
      { org_type: 'personal', status: 'active', is_active: true },
      { org_type: 'platform', status: 'deleted', is_active: true },
      { org_type: 'platform', status: 'active', is_active: false },
    ]) {
      await expect(verifyPlatformOrgConfig(exec({ 'wire_id = ?': [{ ...row, wire_id: PLATFORM }] }), { [PLATFORM_ORG_ENV]: PLATFORM })).rejects.toBeInstanceOf(PlatformOrgConfigError);
    }
  });

  it('set but not (yet) in the projection, or without a type: accepted but unconfirmed', async () => {
    expect(await verifyPlatformOrgConfig(exec({}), { [PLATFORM_ORG_ENV]: PLATFORM })).toBe('unconfirmed');
    const untyped = exec({ 'wire_id = ?': [{ org_type: null, status: 'active', is_active: true, wire_id: PLATFORM }] });
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
