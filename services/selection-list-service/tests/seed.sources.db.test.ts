// seed.sources.db.test.ts - the seed-sources file synced into selection_list_seed_sources
// (plan section 8): upsert what the file lists, DISABLE (never delete) what it no longer lists,
// platform is never a table row, idempotent; and the runtime allowlist read the algorithm uses.

import type { Knex } from 'knex';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import { initSeeding, parseSeedSources, readSeedSource, syncSeedSources } from '../src/seed';

const doc = (sources: unknown[]) => ({ version: 1, attestationScope: 'selection-lists:seed', sources });
const platform = { app: 'platform', kind: 'internal', maxListsPerRequest: 20, maxItemsPerRequest: 2000 };
const app = (name: string, over: Record<string, unknown> = {}) => ({ app: name, allowedSubjects: [`${name}-service`], maxListsPerRequest: 5, maxItemsPerRequest: 100, ...over });

dbDescribe('seed-sources sync (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await db('selection_list_seed_sources').delete();
  });

  it('upserts app sources (platform is never a row), is idempotent, and the runtime read sees what was synced', async () => {
    const sources = parseSeedSources(doc([platform, app('fuzecrm', { keyPrefixes: ['crm-', 'sales-'] }), app('fuzebi')]));
    expect(await syncSeedSources(db, sources)).toEqual({ upserted: ['fuzecrm', 'fuzebi'], disabled: [] });
    expect((await db('selection_list_seed_sources').select('app').orderBy('app')).map((r) => r.app)).toEqual(['fuzebi', 'fuzecrm']);
    expect(await readSeedSource(db, 'platform')).toBeNull();
    expect(await readSeedSource(db, 'fuzecrm')).toEqual({
      app: 'fuzecrm',
      kind: 'app',
      allowedSubjects: ['fuzecrm-service'],
      keyPrefixes: ['crm-', 'sales-'],
      maxListsPerRequest: 5,
      maxItemsPerRequest: 100,
      enabled: true,
    });
    expect(await readSeedSource(db, 'nobody')).toBeNull();
    await syncSeedSources(db, sources); // idempotent
    expect(await db('selection_list_seed_sources')).toHaveLength(2);
  });

  it('updates a changed row in place and DISABLES (never deletes) a source the file no longer lists', async () => {
    await syncSeedSources(db, parseSeedSources(doc([app('fuzecrm'), app('fuzebi')])));
    const second = await syncSeedSources(db, parseSeedSources(doc([app('fuzecrm', { allowedSubjects: ['a', 'b'], maxListsPerRequest: 7 })])));
    expect(second).toEqual({ upserted: ['fuzecrm'], disabled: ['fuzebi'] });
    expect(await readSeedSource(db, 'fuzecrm')).toMatchObject({ allowedSubjects: ['a', 'b'], maxListsPerRequest: 7, enabled: true });
    expect(await readSeedSource(db, 'fuzebi')).toMatchObject({ enabled: false }); // row kept: audit provenance still resolves
    // re-listing it re-enables it
    await syncSeedSources(db, parseSeedSources(doc([app('fuzecrm'), app('fuzebi')])));
    expect(await readSeedSource(db, 'fuzebi')).toMatchObject({ enabled: true });
  });

  it('a file with no app sources disables every row', async () => {
    await syncSeedSources(db, parseSeedSources(doc([app('fuzecrm')])));
    expect(await syncSeedSources(db, parseSeedSources(doc([platform])))).toEqual({ upserted: [], disabled: ['fuzecrm'] });
  });

  it('initSeeding validates the shipped packs + seed-sources.json and syncs: the shipped file (platform only) leaves the table empty', async () => {
    await initSeeding(db);
    expect(await db('selection_list_seed_sources')).toHaveLength(0);
  });
});
