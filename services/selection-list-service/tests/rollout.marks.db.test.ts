// rollout.marks.db.test.ts - the DURABLE one-shot marker of `visibility-org` (selection_list_rollout_marks), the answer to
// "a re-run must not re-flip a list its owner made private later". The first guard (a user's visibility.changed event in the
// outbox) is best effort because the outbox prunes delivered rows after 168 h; the marker is the guard that does not age.
//
// Covered: seed -> run -> owner sets private -> the outbox is PRUNED beyond 168 h -> run again -> still private; the mark is
// written in the SAME transaction as the flips (a failure leaves neither); dry run == apply for marked orgs, with the shared
// reason; one mark per organization whichever rendering its lists are stored under; orgs with seeded lists are marked even
// with nothing to change, orgs without are not; the hard org purge removes the marks and the soft one keeps them; the
// runbook's pre-mark / clear-mark statements work; the migration is additive and reversible.

import type { Knex } from 'knex';
import path from 'path';
import { TOPICS } from '@fuzefront/shared/kafka';
import * as emitters from '../src/events/emitters';
import { handleOrgDeleted } from '../src/events/org-deleted.handler';
import { mintEventId } from '../src/events/outbox';
import { pruneSentOutbox } from '../src/events/outboxRelay';
import { REASON_ORG_DONE } from '../src/rollout/common';
import { runVisibilityOrg } from '../src/rollout/visibilityOrg';
import { createRolloutWorld, dump, expectDryRunAgreesWithApply, orgPair, RolloutWorld, runbookSql } from './helpers/rolloutWorld';
import { createTestDb, dbDescribe } from './helpers/testDb';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const seeded = (listKey: string) => ({ source: 'platform', key: 'platform-defaults', listKey });

dbDescribe('rollout: the visibility-org durable marker (real Postgres)', () => {
  let w: RolloutWorld;
  let seq = 300;
  const newOrg = () => orgPair(++seq);

  beforeAll(async () => {
    w = await createRolloutWorld(state);
  });
  afterAll(() => w.teardown());
  beforeEach(async () => {
    await w.db.raw('TRUNCATE selection_lists, selection_list_items, selection_list_translations, selection_list_item_translations, event_outbox, selection_list_ref_index, selection_list_access, selection_list_rollout_marks RESTART IDENTITY CASCADE');
  });
  afterEach(() => jest.restoreAllMocks());

  const get = (id: string) => w.db('selection_lists').where({ id }).first();
  const marks = () => w.db('selection_list_rollout_marks').orderBy(['job', 'organization_id']);

  it('migration: additive table keyed by (job, organization_id); down() drops it and up() restores it', async () => {
    const cols = (await w.db.raw(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'selection_list_rollout_marks'`)).rows.map((r: any) => r.column_name);
    expect(cols.sort()).toEqual(['completed_at', 'job', 'lists_changed', 'organization_id', 'run_id']);
    const t = await createTestDb(2);
    try {
      const mod = require(path.join(__dirname, '../src/db/migrations/20261026_000014_rollout_marks.ts'));
      await mod.down(t.db);
      expect((await t.db.raw(`SELECT to_regclass('selection_list_rollout_marks') AS r`)).rows[0].r).toBeNull();
      await mod.up(t.db);
      await mod.up(t.db); // idempotent
      expect((await t.db.raw(`SELECT to_regclass('selection_list_rollout_marks') AS r`)).rows[0].r).not.toBeNull();
    } finally {
      await t.drop();
    }
  });

  it('THE REGRESSION: seed -> run -> owner sets private -> outbox pruned beyond 168 h -> run again -> STILL private', async () => {
    const o = newOrg();
    const id = await w.insertList({ key: 'yes-no', org: o.wire, seed: seeded('yes-no') });
    const first = await runVisibilityOrg(w.db, 'apply');
    expect(first.changes.map((c) => c.listId)).toEqual([id]);
    expect((await get(id)).visibility).toBe('org');
    expect(await marks()).toEqual([expect.objectContaining({ job: 'visibility-org', organization_id: o.wire, run_id: first.runId, lists_changed: 1 })]);

    // the owner makes it private on purpose (shared lists ON for them); the service records it ...
    await w.db('selection_lists').where({ id }).update({ visibility: 'private' });
    const eventId = mintEventId();
    await w.db('event_outbox').insert({
      id: eventId, organization_id: o.wire, topic: TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED,
      payload: JSON.stringify({ listId: id, actor: { type: 'user', userId: 'usr_x' } }), correlation_id: 'x', status: 'sent', sent_at: new Date(Date.now() - 200 * 3600_000),
    });
    // ... and the relay prunes delivered rows older than 168 h: the first guard is gone
    expect(await pruneSentOutbox(w.db, 168)).toBeGreaterThanOrEqual(1);
    expect(await w.db('event_outbox').where({ id: eventId }).first()).toBeUndefined();

    const dry = await runVisibilityOrg(w.db, 'dry-run');
    const again = await runVisibilityOrg(w.db, 'apply');
    expect(again.changes).toEqual([]);
    expect(again.skipped).toEqual([expect.objectContaining({ listId: id, reason: REASON_ORG_DONE })]);
    expect((await get(id)).visibility).toBe('private'); // fail closed: not re-published to the org
    expectDryRunAgreesWithApply(dry, again);
  });

  it('the mark is written in the SAME transaction as the flips: a failure leaves neither', async () => {
    const o = newOrg();
    const id = await w.insertList({ key: 'k1', org: o.wire, seed: seeded('k1') });
    const before = await dump(w.db);
    jest.spyOn(emitters, 'emitVisibilityChanged').mockRejectedValueOnce(new Error('boom'));
    await expect(runVisibilityOrg(w.db, 'apply')).rejects.toThrow('boom');
    expect((await get(id)).visibility).toBe('private');
    expect(await marks()).toEqual([]);
    expect(await dump(w.db)).toBe(before);
    jest.restoreAllMocks();
    expect((await runVisibilityOrg(w.db, 'apply')).changes).toHaveLength(1); // and it can simply be re-run
    expect(await marks()).toHaveLength(1);
  });

  it('one mark per organization whichever rendering its lists are stored under; a list added to a marked org later is left alone', async () => {
    const o = newOrg();
    const a = await w.insertList({ key: 'a-list', org: o.uuid, seed: seeded('a-list') });
    const b = await w.insertList({ key: 'b-list', org: o.wire, seed: seeded('b-list') });
    const report = await runVisibilityOrg(w.db, 'apply');
    expect(report.changes.map((c) => c.listId).sort()).toEqual([a, b].sort());
    expect(await marks()).toEqual([expect.objectContaining({ organization_id: o.wire, lists_changed: 2 })]);
    const later = await w.insertList({ key: 'later', org: o.uuid, seed: seeded('later') }); // seeded private after the run
    const again = await runVisibilityOrg(w.db, 'apply');
    expect(again.changes).toEqual([]);
    expect(again.skipped.map((s) => s.listId)).toEqual([later]);
    expect((await get(later)).visibility).toBe('private');
  });

  it('an org whose seeded lists need no change is marked too; an org without seeded lists is not', async () => {
    const done = newOrg();
    await w.insertList({ key: 'ready', org: done.wire, visibility: 'org', seed: seeded('ready') });
    const none = newOrg();
    await w.insertList({ key: 'mine', org: none.wire }); // user-authored only
    await runVisibilityOrg(w.db, 'apply');
    expect((await marks()).map((m: any) => [m.organization_id, m.lists_changed])).toEqual([[done.wire, 0]]);
  });

  it('dry run == apply with some orgs marked and some not (same changes, skipped reasons, counters)', async () => {
    const marked = newOrg();
    const fresh = newOrg();
    await w.insertList({ key: 'm1', org: marked.wire, seed: seeded('m1') });
    await runVisibilityOrg(w.db, 'apply'); // marks `marked`
    await w.insertList({ key: 'm2', org: marked.wire, seed: seeded('m2') });
    await w.insertList({ key: 'f1', org: fresh.uuid, seed: seeded('f1') });
    const dry = await runVisibilityOrg(w.db, 'dry-run');
    expect(dry.skipped.map((s) => s.reason)).toEqual([REASON_ORG_DONE]);
    expect(dry.changes).toHaveLength(1);
    const applied = await runVisibilityOrg(w.db, 'apply');
    expectDryRunAgreesWithApply(dry, applied);
  });

  it('two runs at once: one mark per org, every list flipped once', async () => {
    const orgs = [newOrg(), newOrg(), newOrg()];
    for (const [i, o] of orgs.entries()) await w.insertList({ key: `c-${i}`, org: i % 2 ? o.uuid : o.wire, seed: seeded(`c-${i}`) });
    const [r1, r2] = await Promise.all([runVisibilityOrg(w.db, 'apply'), runVisibilityOrg(w.db, 'apply')]);
    expect(r1.changes.length + r2.changes.length).toBe(3);
    expect(await marks()).toHaveLength(3);
  });

  it('identity.org.deleted: the HARD purge removes the org\'s marks, the SOFT cascade keeps them (a restore must not re-flip)', async () => {
    const o = newOrg();
    const other = newOrg();
    await w.insertList({ key: 'x1', org: o.wire, seed: seeded('x1') });
    await w.insertList({ key: 'x2', org: other.wire, seed: seeded('x2') });
    await runVisibilityOrg(w.db, 'apply');
    expect(await marks()).toHaveLength(2);
    const ev = (cascade: 'soft' | 'hard') => ({ correlationId: 'c', occurredAt: new Date().toISOString(), payload: { organizationId: o.uuid, slug: 's', ownerId: null, cascade } }) as any;
    await handleOrgDeleted(ev('soft'));
    expect((await marks()).map((m: any) => m.organization_id).sort()).toEqual([o.wire, other.wire].sort());
    await handleOrgDeleted(ev('hard'));
    expect((await marks()).map((m: any) => m.organization_id)).toEqual([other.wire]);
  });

  it('runbook: the PRE-MARK statement protects an org before its first run; the CLEAR-MARK statement re-enables it on purpose', async () => {
    const o = newOrg();
    const id = await w.insertList({ key: 'p1', org: o.wire, seed: seeded('p1') });
    const pre = runbookSql('-- PRE-MARK visibility-org').replace(/<org_…>/g, o.wire);
    await w.db.raw(pre);
    await w.db.raw(pre); // idempotent
    const skipped = await runVisibilityOrg(w.db, 'apply');
    expect(skipped.changes).toEqual([]);
    expect((await get(id)).visibility).toBe('private');
    await w.db.raw(runbookSql('-- CLEAR-MARK visibility-org').replace(/<org_…>/g, o.wire));
    expect(await marks()).toEqual([]);
    expect((await runVisibilityOrg(w.db, 'apply')).changes.map((c) => c.listId)).toEqual([id]);
    expect(await marks()).toHaveLength(1);
  });
});
