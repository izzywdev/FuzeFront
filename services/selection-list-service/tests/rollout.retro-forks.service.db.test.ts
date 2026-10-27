// rollout.retro-forks.service.db.test.ts - the point of design record 9.6, seen through the REAL service: after the job
// turns a legacy per-organization copy into a fork of the common list,
//   - a stored COMMON item id resolves to the copy's item (`effective_item_id`, D9),
//   - the listing shows `forked_from`,
//   - the key still shadows the common list for that org (precedence unchanged),
//   - POST /fork answers the existing fork instead of creating a second one (idempotent),
//   - and the whole job ran with the shared-lists flag in either state (it never reads it).
// Real Express app, real Postgres, scriptable Security API (tests/helpers/sharedWorld.ts).

import type { Knex } from 'knex';
import { mintId } from '@izzywdev/fuzefront-identity';
import { dbDescribe } from './helpers/testDb';
import { createWorld, ORG_A, P, publishPriorityList, World } from './helpers/sharedWorld';
import { flagClientWith } from './helpers/flagClient';
import { runRetroForks } from '../src/rollout/retroForks';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('rollout: retro-forks as the service sees it (real Postgres + real app)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };
  let copyId: string;
  let copyLow: string;
  let copyCustom: string;

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
    // The legacy per-org copy a platform pack seeded long ago: same key, org-readable, one custom item.
    copyId = mintId('selectionList');
    await w.db('selection_lists').insert({
      id: copyId, organization_id: ORG_A, key: 'priority', created_by: 'system:selection-list-service', visibility: 'org',
      seed_source: 'platform', seed_key: 'platform-defaults', seed_list_key: 'priority', seed_version: 1, seed_hash: 'h',
    });
    await w.db('selection_list_translations').insert({ list_id: copyId, locale: 'en', name: 'Our priorities', source_hash: 'h', is_machine: false });
    const mk = async (code: string, label: string) => {
      const id = mintId('selectionListItem');
      await w.db('selection_list_items').insert({ id, list_id: copyId, code, sort_order: 1, status: 'active', created_by: 'system:selection-list-service' });
      await w.db('selection_list_item_translations').insert({ item_id: id, locale: 'en', label, source_hash: 'h', is_machine: false });
      return id;
    };
    copyLow = await mk('LOW', 'Low (ours)');
    await mk('MID', 'Mid (ours)');
    copyCustom = await mk('URGENT', 'Urgent (ours)');
    await w.newEvents();
  });
  afterAll(() => w.teardown());

  const resolve = async (ids: string[]) => (await w.api(P.aMember).post('/v1/resolve', { ids })).body;

  it('before the job: a stored common id resolves to the common item (no redirect), and the copy is a plain list', async () => {
    const r = await resolve([platform.low]);
    expect(r.results[platform.low]).toMatchObject({ label: 'Low' });
    expect(r.results[platform.low]).not.toHaveProperty('effective_item_id');
  });

  it('flag ON or OFF, the job does the same (it reads no flag): dry run first, then apply', async () => {
    for (const on of [false, true]) {
      (await import('../src/flags')).setFlagClient(flagClientWith(on));
      const dry = await runRetroForks(w.db, 'dry-run');
      expect(dry.changes.map((c) => c.listId)).toEqual([copyId]);
    }
    const report = await runRetroForks(w.db, 'apply');
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].detail).toMatchObject({ itemsMapped: 2 }); // LOW, MID (URGENT has no common twin)
    (await import('../src/flags')).setFlagClient(flagClientWith(true));
  });

  it('after the job: the common item id redirects to the copy\'s item (effective_item_id); the custom item has no origin', async () => {
    const r = await resolve([platform.low, platform.mid]);
    expect(r.results[platform.low]).toMatchObject({ label: 'Low (ours)', effective_item_id: copyLow });
    expect(r.results[platform.mid].effective_item_id).toBeDefined();
    expect((await w.db('selection_list_items').where({ id: copyCustom }).first()).origin_item_id).toBeNull();
    // both ids keep resolving
    expect((await resolve([copyLow])).results[copyLow]).toMatchObject({ label: 'Low (ours)' });
  });

  it('after the job: the listing carries forked_from, and the key still resolves to the org\'s own list (shadowing unchanged)', async () => {
    const res = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&key=priority');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: copyId, visibility: 'org', forked_from: { list_id: platform.listId } });
  });

  it('after the job: POST /fork answers the existing fork (200) and creates nothing', async () => {
    const res = await w.api(P.aMember).post(`/v1/selection-lists/${platform.listId}/fork`, {});
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(copyId);
    expect(await w.db('selection_lists').where({ organization_id: ORG_A, key: 'priority' }).count<{ n: string }>('* as n').first()).toEqual({ n: '1' });
  });

  it('a re-run is a no-op', async () => {
    const again = await runRetroForks(w.db, 'apply');
    expect(again.changes).toEqual([]);
  });
});
