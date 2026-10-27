// rollout.cli.db.test.ts - the CLI entry (src/rollout/cli.ts `main`) end to end against real Postgres: default mode is a
// dry run, exit codes (0 / 1 / 2 / 3), the text and --json reports, and that nothing is written without --apply.

import type { Knex } from 'knex';
import { createRolloutWorld, dump, orgPair, PLATFORM, RolloutWorld } from './helpers/rolloutWorld';
import { dbDescribe } from './helpers/testDb';
import { _resetPlatformOrgCacheForTesting } from '../src/lib/sharedLists';
import { main } from '../src/rollout/cli';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('rollout CLI (real Postgres)', () => {
  let w: RolloutWorld;
  let out = '';
  let spy: jest.SpyInstance;

  beforeAll(async () => {
    w = await createRolloutWorld(state);
  });
  afterAll(async () => {
    delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
    _resetPlatformOrgCacheForTesting();
    await w.t.drop().catch(() => undefined);
  });
  beforeEach(async () => {
    await w.db.raw('TRUNCATE selection_lists, selection_list_items, selection_list_translations, selection_list_item_translations, event_outbox, selection_list_ref_index, selection_list_access, selection_list_rollout_marks RESTART IDENTITY CASCADE');
    delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
    _resetPlatformOrgCacheForTesting();
    out = '';
    spy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array, cb?: () => void) => {
      out += String(chunk);
      cb?.(); // the CLI waits for the write callback before it returns
      return true;
    }) as never);
  });
  afterEach(() => spy.mockRestore());

  // main() destroys the pool it is given when it finishes (it is a process entry point), so give each call a fresh one.
  const run = async (...argv: string[]): Promise<number> => {
    const keep = state.db as Knex;
    const fresh = require('knex')({ client: 'pg', connection: process.env.SLS_TEST_DATABASE_URL, searchPath: [w.t.schema], pool: { min: 0, max: 4 } }) as Knex;
    state.db = fresh;
    try {
      return await main(argv);
    } finally {
      state.db = keep;
    }
  };

  async function dup() {
    const o = orgPair(0x50);
    const a = await w.insertList({ key: 'yes-no', org: o.uuid, ageMin: 90, seed: { source: 'platform', key: 'platform-defaults', listKey: 'yes-no' } });
    const b = await w.insertList({ key: 'yes-no', org: o.wire, ageMin: 10 });
    return { o, a, b };
  }

  it('usage errors exit 1 and print the usage', async () => {
    expect(await run()).toBe(1);
    expect(out).toContain('no job given');
    expect(out).toContain('usage: node dist/rollout/cli.js');
    out = '';
    expect(await run('audit', '--apply')).toBe(1);
    expect(await run('reconcile-duplicates', '--dry-run', '--apply')).toBe(1);
  });

  it('audit: exit 2 while duplicates exist (and prints them), exit 0 when clean', async () => {
    const x = await dup();
    expect(await run('audit')).toBe(2);
    expect(out).toContain('duplicate-key');
    expect(out).toContain(x.a);
    await run('reconcile-duplicates', '--apply');
    out = '';
    expect(await run('audit')).toBe(0);
    expect(out).toContain('keyDuplicateGroups: 0');
  });

  it('with no mode flag a job is a DRY RUN: it prints "would change" and writes nothing', async () => {
    const x = await dup();
    const before = await dump(w.db);
    expect(await run('reconcile-duplicates')).toBe(0);
    expect(out).toContain('DRY RUN: nothing was written');
    expect(out).toContain('WOULD CHANGE (1)');
    expect(out).toContain(x.b);
    expect(await dump(w.db)).toBe(before);
    out = '';
    expect(await run('reconcile-duplicates', '--dry-run')).toBe(0);
    expect(await dump(w.db)).toBe(before);
  });

  it('--apply writes, --json prints one parseable report, and the re-run reports nothing to do', async () => {
    const x = await dup();
    expect(await run('reconcile-duplicates', '--apply', '--json')).toBe(0);
    const report = JSON.parse(out.trim());
    expect(report).toMatchObject({ job: 'reconcile-duplicates', mode: 'apply', summary: { renamedAndArchived: 1 } });
    expect(report.changes[0].listId).toBe(x.b);
    out = '';
    expect(await run('reconcile-duplicates', '--apply', '--json')).toBe(0);
    expect(JSON.parse(out.trim()).changes).toEqual([]);
  });

  it('visibility-org through the CLI', async () => {
    const o = orgPair(0x51);
    const id = await w.insertList({ key: 'kk', org: o.wire, seed: { source: 'platform', key: 'platform-defaults', listKey: 'kk' } });
    expect(await run('visibility-org')).toBe(0);
    expect((await w.db('selection_lists').where({ id }).first()).visibility).toBe('private');
    expect(await run('visibility-org', '--apply')).toBe(0);
    expect((await w.db('selection_lists').where({ id }).first()).visibility).toBe('org');
  });

  it('retro-forks without a confirmed platform organization exits 3 and writes nothing', async () => {
    await dup();
    const before = await dump(w.db);
    expect(await run('retro-forks', '--apply')).toBe(3);
    expect(out).toContain('PRECONDITION NOT MET (nothing was written)');
    expect(await dump(w.db)).toBe(before);
  });

  it('an apply that leaves a BLOCKED item exits 2 (a common list is never auto-archived)', async () => {
    const o = orgPair(0x52);
    await w.insertList({ key: 'c', org: o.uuid, ageMin: 100 });
    await w.insertList({ key: 'c', org: o.wire, ageMin: 5, visibility: 'platform' });
    expect(await run('reconcile-duplicates', '--apply')).toBe(2);
    expect(out).toContain('BLOCKED (needs an operator)');
    expect(PLATFORM.wire).toBeTruthy();
  });
});
