// seed.unit.test.ts - the parts of the seed library that need no database: canonical hashing,
// the shipped platform pack (plan S8: "a unit test validates every shipped pack"), the pack and
// seed-sources loaders' refusals, the failure-reason table, and the flag gate (both states).

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  SELECTION_LIST_LIMITS,
  SELECTION_LIST_LOCALES,
  SELECTION_LIST_SEED_FAILURE_REASONS,
  selectionListSeedPackSchemaV1,
} from '@fuzefront/shared/kafka';
import { canonicalJson, hashCanonical } from '../src/seed/canonical';
import { hashItemContent, hashListContent, itemContentFromSpec, listContentFromSpec } from '../src/seed/content';
import {
  currentPlatformPacks,
  DEFAULT_PLATFORM_PACK_DIR,
  loadPlatformPack,
  loadPlatformPacks,
  loadSeedSources,
  parseSeedSources,
  SEED_ATTESTATION_SCOPE,
  SEED_FAILURE_RETRYABLE,
  SeedPackError,
  SeedSourcesFileError,
  isSeedingEnabled,
} from '../src/seed';
import { FLAGS, setFlagClient } from '../src/flags';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sls-packs-'));
const write = (dir: string, name: string, doc: unknown) => fs.writeFileSync(path.join(dir, name), typeof doc === 'string' ? doc : JSON.stringify(doc));
const minimalPack = (over: Record<string, unknown> = {}) => ({
  packKey: 'mini',
  version: 1,
  appliesTo: ['organization'],
  lists: [{ key: 'mini-list', sourceLocale: 'en', name: 'Mini', items: [{ code: 'A', label: 'A' }] }],
  ...over,
});

describe('canonical hashing', () => {
  it('is independent of key order, drops undefined, keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 1] }, u: undefined })).toBe('{"a":{"c":[3,1],"d":2},"b":1}');
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
    expect(hashCanonical([1, 2])).not.toBe(hashCanonical([2, 1]));
    expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('content hashes: translation order does not matter, any text/status/translation change does', () => {
    const base = { key: 'k-list', sourceLocale: 'en' as const, name: 'N', translations: [{ locale: 'es' as const, name: 'n' }, { locale: 'fr' as const, name: 'nf' }], items: [] };
    const swapped = { ...base, translations: [...base.translations].reverse() };
    expect(hashListContent(listContentFromSpec(base))).toBe(hashListContent(listContentFromSpec(swapped)));
    expect(hashListContent(listContentFromSpec(base))).not.toBe(hashListContent(listContentFromSpec({ ...base, name: 'N2' })));
    expect(hashListContent(listContentFromSpec(base))).not.toBe(hashListContent(listContentFromSpec(base, 'archived')));
    expect(hashListContent(listContentFromSpec(base))).not.toBe(hashListContent(listContentFromSpec({ ...base, translations: [base.translations[0]] })));
    const item = { code: 'A', label: 'A', translations: [{ locale: 'es' as const, label: 'a' }] };
    expect(hashItemContent(itemContentFromSpec(item))).not.toBe(hashItemContent(itemContentFromSpec(item, 'archived')));
    expect(hashItemContent(itemContentFromSpec(item))).not.toBe(hashItemContent(itemContentFromSpec({ ...item, description: 'd' })));
    // list and item hashes are domain-separated
    expect(hashItemContent({ label: 'N', description: null, status: 'active', translations: [] })).not.toBe(
      hashListContent({ key: 'x', sourceLocale: 'en', status: 'active', name: 'N', description: null, translations: [] }),
    );
  });
});

describe('shipped platform packs (S8)', () => {
  it('every shipped pack validates against selectionListSeedPackSchemaV1 and the loader accepts the directory', () => {
    const packs = loadPlatformPacks();
    expect(packs.length).toBeGreaterThanOrEqual(1);
    for (const { pack, file } of packs) {
      expect(selectionListSeedPackSchemaV1.safeParse(JSON.parse(fs.readFileSync(file, 'utf8'))).success).toBe(true);
      expect(path.basename(file)).toBe(`${pack.packKey}.v${pack.version}.json`);
    }
  });

  it('platform-defaults v1 is the plan catalogue: yes-no, priority, work-status - 3 lists, 10 items, all 11 locales, human (not machine) text', () => {
    const pack = loadPlatformPack('platform-defaults', 1);
    expect(pack.appliesTo).toEqual(['organization', 'personal']); // never the root `platform` org by default
    expect(pack.lists.map((l) => [l.key, l.items.map((i) => i.code)])).toEqual([
      ['yes-no', ['YES', 'NO']],
      ['priority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT']],
      ['work-status', ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'DONE']],
    ]);
    expect(pack.lists.reduce((n, l) => n + l.items.length, 0)).toBe(10);
    const nonSource = SELECTION_LIST_LOCALES.filter((l) => l !== 'en').sort();
    for (const l of pack.lists) {
      expect(l.sourceLocale).toBe('en');
      expect((l.translations ?? []).map((x) => x.locale).sort()).toEqual(nonSource);
      for (const i of l.items) expect((i.translations ?? []).map((x) => x.locale).sort()).toEqual(nonSource);
    }
    // within the contract limits
    expect(pack.lists.length).toBeLessThanOrEqual(SELECTION_LIST_LIMITS.MAX_LISTS_PER_SEED);
    expect(pack.lists.every((l) => l.items.length <= SELECTION_LIST_LIMITS.MAX_ITEMS_PER_LIST)).toBe(true);
  });

  it('the default loader resolves the highest version; currentPlatformPacks yields one pack per key', () => {
    expect(loadPlatformPack().version).toBeGreaterThanOrEqual(1);
    expect(currentPlatformPacks().map((p) => p.packKey)).toContain('platform-defaults');
    expect(() => loadPlatformPack('no-such-pack')).toThrow(SeedPackError);
    expect(() => loadPlatformPack('platform-defaults', 99)).toThrow(SeedPackError);
  });

  it('currentPlatformPacks picks the newest version per key', () => {
    const dir = tmp();
    write(dir, 'mini.v1.json', minimalPack());
    write(dir, 'mini.v2.json', minimalPack({ version: 2 }));
    expect(currentPlatformPacks(dir).map((p) => `${p.packKey}@${p.version}`)).toEqual(['mini@2']);
    expect(loadPlatformPack('mini', 1, dir).version).toBe(1);
  });
});

describe('platform pack loader refusals (the service refuses to start on a bad pack)', () => {
  it('refuses a file that fails the schema, with the offending path', () => {
    const dir = tmp();
    write(dir, 'mini.v1.json', minimalPack({ lists: [{ key: 'mini-list', sourceLocale: 'xx', name: 'Mini', items: [] }] }));
    expect(() => loadPlatformPacks(dir)).toThrow(/lists\.0\.sourceLocale/);
  });

  it('refuses a smuggled id (the pack format is strict, like seed.requested)', () => {
    const dir = tmp();
    write(dir, 'mini.v1.json', minimalPack({ lists: [{ id: 'front_sl_x', key: 'mini-list', sourceLocale: 'en', name: 'Mini', items: [] }] }));
    expect(() => loadPlatformPacks(dir)).toThrow(SeedPackError);
  });

  it('refuses a source-locale translation and a duplicate item code', () => {
    const dir = tmp();
    write(dir, 'mini.v1.json', minimalPack({ lists: [{ key: 'mini-list', sourceLocale: 'en', name: 'M', translations: [{ locale: 'en', name: 'M' }], items: [] }] }));
    expect(() => loadPlatformPacks(dir)).toThrow(/source locale/);
    write(dir, 'mini.v1.json', minimalPack({ lists: [{ key: 'mini-list', sourceLocale: 'en', name: 'M', items: [{ code: 'A', label: 'a' }, { code: 'A', label: 'b' }] }] }));
    expect(() => loadPlatformPacks(dir)).toThrow(/duplicate item code/);
  });

  it('refuses a file whose name disagrees with its content, a bad file name, unparseable JSON, and an unreadable directory', () => {
    const dir = tmp();
    write(dir, 'mini.v2.json', minimalPack()); // says v1
    expect(() => loadPlatformPacks(dir)).toThrow(/file name says mini v2 but the content says mini v1/);
    fs.rmSync(path.join(dir, 'mini.v2.json'));
    write(dir, 'wrong-name.json', minimalPack());
    expect(() => loadPlatformPacks(dir)).toThrow(/<packKey>\.v<version>\.json/);
    fs.rmSync(path.join(dir, 'wrong-name.json'));
    write(dir, 'mini.v1.json', '{ not json');
    expect(() => loadPlatformPacks(dir)).toThrow(/cannot read\/parse/);
    expect(() => loadPlatformPacks(path.join(dir, 'nope'))).toThrow(/cannot read pack directory/);
  });

  it('DEFAULT_PLATFORM_PACK_DIR points at the shipped seed-packs/platform directory', () => {
    expect(DEFAULT_PLATFORM_PACK_DIR.endsWith(path.join('seed-packs', 'platform'))).toBe(true);
    expect(fs.existsSync(DEFAULT_PLATFORM_PACK_DIR)).toBe(true);
  });
});

describe('seed-sources.json', () => {
  it('the shipped file declares ONLY the platform source (no app source is invented) and the attestation scope', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed-sources.json'), 'utf8'));
    expect(doc.attestationScope).toBe(SEED_ATTESTATION_SCOPE);
    expect(SEED_ATTESTATION_SCOPE).toBe('selection-lists:seed');
    const sources = loadSeedSources();
    expect(sources.map((s) => [s.app, s.kind])).toEqual([['platform', 'internal']]);
  });

  const doc = (sources: unknown[], over: Record<string, unknown> = {}) => ({ version: 1, attestationScope: 'selection-lists:seed', sources, ...over });
  const app = (over: Record<string, unknown> = {}) => ({ app: 'fuzecrm', allowedSubjects: ['fuzecrm-service'], maxListsPerRequest: 5, maxItemsPerRequest: 100, ...over });

  it('normalises an app source: key prefix defaults to "<app>-", enabled defaults to true', () => {
    const [s] = parseSeedSources(doc([app()]));
    expect(s).toEqual({ app: 'fuzecrm', kind: 'app', allowedSubjects: ['fuzecrm-service'], keyPrefixes: ['fuzecrm-'], maxListsPerRequest: 5, maxItemsPerRequest: 100, enabled: true });
    expect(parseSeedSources(doc([app({ keyPrefixes: ['crm-', 'sales-'], enabled: false })]))[0]).toMatchObject({ keyPrefixes: ['crm-', 'sales-'], enabled: false });
  });

  it.each([
    ['platform declared as an app source', doc([{ ...app(), app: 'platform' }])],
    ['duplicate source', doc([app(), app()])],
    ['caps above the contract (21 lists)', doc([app({ maxListsPerRequest: 21 })])],
    ['caps above the contract (2001 items)', doc([app({ maxItemsPerRequest: 2001 })])],
    ['no allowed subjects', doc([app({ allowedSubjects: [] })])],
    ['an unknown field', doc([app({ extra: 1 })])],
    ['a bad key prefix', doc([app({ keyPrefixes: ['Bad Prefix'] })])],
    ['a wrong attestation scope', doc([app()], { attestationScope: 'authz:admin' })],
    ['an unsupported version', doc([app()], { version: 2 })],
  ])('refuses %s', (_name, bad) => {
    expect(() => parseSeedSources(bad)).toThrow(SeedSourcesFileError);
  });

  it('refuses an unreadable file', () => {
    expect(() => loadSeedSources(path.join(os.tmpdir(), 'definitely-not-here.json'))).toThrow(SeedSourcesFileError);
  });
});

describe('failure reasons', () => {
  it('every seed.failed reason has a default retryable verdict, matching the schema doc', () => {
    expect(Object.keys(SEED_FAILURE_RETRYABLE).sort()).toEqual([...SELECTION_LIST_SEED_FAILURE_REASONS].sort());
    const retryable = SELECTION_LIST_SEED_FAILURE_REASONS.filter((r) => SEED_FAILURE_RETRYABLE[r]).sort();
    expect(retryable).toEqual(['ATTESTATION_INVALID', 'INTERNAL_ERROR', 'KEY_CONFLICT', 'ORG_UNKNOWN', 'QUOTA_EXCEEDED', 'SEEDING_DISABLED'].sort());
  });
});

describe('isSeedingEnabled - the caller-side flag check (both states, both flags)', () => {
  afterEach(() => setFlagClient(null));
  const pin = (values: Record<string, boolean>) =>
    setFlagClient({ getBooleanValue: async (key: string) => values[key] ?? false });

  it('is true only when the master gate AND the seed-defaults flag are ON', async () => {
    pin({ [FLAGS.SELECTION_LISTS_SERVICE]: true, [FLAGS.SELECTION_LISTS_SEED_DEFAULTS]: true });
    expect(await isSeedingEnabled('org_x')).toBe(true);
    pin({ [FLAGS.SELECTION_LISTS_SERVICE]: true, [FLAGS.SELECTION_LISTS_SEED_DEFAULTS]: false });
    expect(await isSeedingEnabled('org_x')).toBe(false);
    pin({ [FLAGS.SELECTION_LISTS_SERVICE]: false, [FLAGS.SELECTION_LISTS_SEED_DEFAULTS]: true });
    expect(await isSeedingEnabled('org_x')).toBe(false);
    pin({});
    expect(await isSeedingEnabled('org_x')).toBe(false);
  });

  it('fails closed when the flag client throws, and passes the organization into the evaluation context', async () => {
    setFlagClient({ getBooleanValue: async () => { throw new Error('unleash down'); } });
    expect(await isSeedingEnabled('org_x')).toBe(false);
    const seen: Array<Record<string, unknown> | undefined> = [];
    setFlagClient({ getBooleanValue: async (_k, _d, ctx) => { seen.push(ctx); return true; } });
    expect(await isSeedingEnabled('org_ctx')).toBe(true);
    expect(seen.every((c) => c?.orgId === 'org_ctx' && c?.app === 'selection-list-service')).toBe(true);
    expect(seen).toHaveLength(2);
  });
});
