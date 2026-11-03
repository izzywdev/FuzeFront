// migrations.shared-lists.db.test.ts - migration 11 (shared / common lists + copy-on-write forks,
// docs/planning/selection-lists-shared-and-fork.md section 5) against REAL Postgres.
//
// Proves: additive over a POPULATED database (every existing list becomes 'private', nothing else
// moves - R7), the CHECK constraints (visibility domain, fork all-or-none, fork is never platform), the
// one-fork-per-(org, source) idempotency index, the origin-item uniqueness, the lookup indexes, and the
// down()/up() round trip. Runs when SLS_TEST_DATABASE_URL is set; in CI a missing DB is a FAILURE.

import knexFactory, { Knex } from 'knex';
import path from 'path';
import { randomBytes } from 'crypto';

const URL_ENV = process.env.SLS_TEST_DATABASE_URL;
const inCI = Boolean(process.env.CI);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

const suite = URL_ENV ? describe : inCI ? describe : describe.skip;

if (!URL_ENV) {
  if (inCI) {
    describe('migrations.shared-lists.db (CI requires a database)', () => {
      it('SLS_TEST_DATABASE_URL must be set in CI', () => {
        throw new Error('SLS_TEST_DATABASE_URL is not set but CI=true.');
      });
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn('[migrations.shared-lists.db.test] SKIPPED: set SLS_TEST_DATABASE_URL to run.');
  }
}

suite('migration 11 (shared lists + forks) on real Postgres', () => {
  const schemas: string[] = [];
  const handles: Knex[] = [];
  const admin = () => knexFactory({ client: 'pg', connection: URL_ENV, pool: { min: 1, max: 1 } });

  async function fresh(): Promise<Knex> {
    const schema = `slv_${randomBytes(6).toString('hex')}`;
    const a = admin();
    await a.raw(`CREATE SCHEMA ${schema}`);
    await a.destroy();
    schemas.push(schema);
    const db = knexFactory({
      client: 'pg',
      connection: URL_ENV,
      searchPath: [schema],
      pool: { min: 1, max: 4 },
      migrations: { directory: MIGRATIONS_DIR, extension: 'ts', loadExtensions: ['.ts'] },
    });
    handles.push(db);
    return db;
  }

  afterAll(async () => {
    await Promise.all(handles.map((h) => h.destroy()));
    const a = admin();
    for (const s of schemas) await a.raw(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await a.destroy();
  });

  const columns = async (db: Knex, table: string): Promise<string[]> =>
    (
      await db.raw(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
        [table],
      )
    ).rows.map((r: any) => r.column_name);

  const indexes = async (db: Knex, table: string): Promise<string[]> =>
    (
      await db.raw(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?`, [table])
    ).rows.map((r: any) => r.indexname);

  const expectCode = async (p: Promise<unknown>, code: string) => {
    await expect(p).rejects.toMatchObject({ code });
  };

  it('is additive over a populated database: existing lists become private, nothing else moves (R7)', async () => {
    const db = await fresh();
    await db.migrate.up(); // 1 .. 10
    for (let i = 1; i < 10; i++) await db.migrate.up();
    expect(await columns(db, 'selection_lists')).not.toContain('visibility');
    await db('selection_lists').insert([
      { id: 'front_sl_a', organization_id: 'org_1', key: 'colors', created_by: 'usr_1' },
      { id: 'front_sl_b', organization_id: 'org_2', key: 'colors', created_by: 'usr_2', status: 'archived' },
    ]);
    await db('selection_list_items').insert({ id: 'front_sli_a', list_id: 'front_sl_a', code: 'RED', sort_order: 100, created_by: 'usr_1' });

    const [, applied] = await db.migrate.latest();
    expect(applied).toEqual(['20261005_000011_shared_lists_and_forks.ts', '20261014_000012_ref_index_owner_uuid.ts', '20261015_000013_ref_index_suspended.ts', '20261026_000014_rollout_marks.ts']);

    const lists = await db('selection_lists').orderBy('id');
    expect(lists.map((l: any) => [l.id, l.visibility, l.forked_from_list_id, l.forked_from_org_id, l.forked_from_revision, l.forked_at, l.status]))
      .toEqual([
        ['front_sl_a', 'private', null, null, null, null, 'active'],
        ['front_sl_b', 'private', null, null, null, null, 'archived'],
      ]);
    expect((await db('selection_list_items').first()).origin_item_id).toBeNull();
    const cols = await columns(db, 'selection_lists');
    for (const c of ['visibility', 'forked_from_list_id', 'forked_from_org_id', 'forked_from_revision', 'forked_at']) {
      expect(cols).toContain(c);
    }
    expect(await columns(db, 'selection_list_items')).toContain('origin_item_id');
  });

  it('creates the lookup and idempotency indexes', async () => {
    const db = await fresh();
    await db.migrate.latest();
    expect(await indexes(db, 'selection_lists')).toEqual(
      expect.arrayContaining(['ux_sl_fork_per_org', 'ix_sl_platform_key', 'ix_sl_org_visible']),
    );
    expect(await indexes(db, 'selection_list_items')).toContain('ux_sli_origin');
  });

  describe('constraints', () => {
    let db: Knex;
    beforeAll(async () => {
      db = await fresh();
      await db.migrate.latest();
    });

    const list = (id: string, over: Record<string, unknown> = {}) => ({
      id, organization_id: 'org_1', key: `key_${id}`, created_by: 'usr_1', ...over,
    });
    const fork = (src: string, over: Record<string, unknown> = {}) => ({
      forked_from_list_id: src, forked_from_org_id: 'org_platform', forked_from_revision: 3, forked_at: new Date(), ...over,
    });

    it('visibility defaults to private and only accepts private | org | platform', async () => {
      await db('selection_lists').insert(list('front_sl_v0'));
      expect((await db('selection_lists').where({ id: 'front_sl_v0' }).first()).visibility).toBe('private');
      await db('selection_lists').insert(list('front_sl_v1', { visibility: 'org' }));
      await db('selection_lists').insert(list('front_sl_v2', { organization_id: 'org_platform', visibility: 'platform' }));
      await expectCode(db('selection_lists').insert(list('front_sl_v3', { visibility: 'public' })), '23514');
      await expectCode(db('selection_lists').insert(list('front_sl_v4', { visibility: null })), '23502');
    });

    it('the four forked_* columns are all-or-nothing', async () => {
      await db('selection_lists').insert(list('front_sl_f0', fork('front_sl_v2')));
      await expectCode(db('selection_lists').insert(list('front_sl_f1', { forked_from_list_id: 'front_sl_v2' })), '23514');
      await expectCode(db('selection_lists').insert(list('front_sl_f2', { forked_from_org_id: 'org_platform' })), '23514');
      await expectCode(
        db('selection_lists').insert(list('front_sl_f3', fork('front_sl_v2', { forked_from_revision: null }))),
        '23514',
      );
      await expectCode(db('selection_lists').insert(list('front_sl_f4', fork('front_sl_v2', { forked_at: null }))),
        '23514');
    });

    it('a fork is never a platform list', async () => {
      await expectCode(
        db('selection_lists').insert(list('front_sl_p0', { visibility: 'platform', ...fork('front_sl_v2') })),
        '23514',
      );
      await db('selection_lists').insert(list('front_sl_p1', { visibility: 'org', key: 'p1', ...fork('front_sl_v9') }));
      await expectCode(db('selection_lists').where({ id: 'front_sl_p1' }).update({ visibility: 'platform' }), '23514');
    });

    it('one fork per (organization, source): the idempotency key of POST .../fork', async () => {
      await db('selection_lists').insert(list('front_sl_u0', { organization_id: 'org_a', key: 'colors', ...fork('front_sl_src') }));
      // same org, same source, different key -> still refused (any status)
      await expectCode(
        db('selection_lists').insert(list('front_sl_u1', { organization_id: 'org_a', key: 'colors-2', ...fork('front_sl_src') })),
        '23505',
      );
      await db('selection_lists').where({ id: 'front_sl_u0' }).update({ status: 'archived' });
      await expectCode(
        db('selection_lists').insert(list('front_sl_u2', { organization_id: 'org_a', key: 'colors-3', ...fork('front_sl_src') })),
        '23505',
      );
      // another org may fork the same source; the same org may fork another source
      await db('selection_lists').insert(list('front_sl_u3', { organization_id: 'org_b', key: 'colors', ...fork('front_sl_src') }));
      await db('selection_lists').insert(list('front_sl_u4', { organization_id: 'org_a', key: 'sizes', ...fork('front_sl_src2') }));
      // non-fork rows never collide on the partial index
      await db('selection_lists').insert([list('front_sl_n1', { organization_id: 'org_a' }), list('front_sl_n2', { organization_id: 'org_a' })]);
      // the fork keeps the key but stays unique per org
      await expectCode(
        db('selection_lists').insert(list('front_sl_u5', { organization_id: 'org_a', key: 'sizes', ...fork('front_sl_src3') })),
        '23505',
      );
    });

    it('the source is a provenance reference, not a FK: it may be absent (purged) or in another tenant', async () => {
      await db('selection_lists').insert(list('front_sl_g0', { organization_id: 'org_z', key: 'gone', ...fork('front_sl_does_not_exist') }));
      expect((await db('selection_lists').where({ id: 'front_sl_g0' }).first()).forked_from_list_id).toBe('front_sl_does_not_exist');
    });

    it('origin_item_id is unique per list; many null origins are fine; it is not a FK', async () => {
      await db('selection_lists').insert(list('front_sl_o0', { organization_id: 'org_o', key: 'o0' }));
      const item = (id: string, code: string, origin: string | null) => ({
        id, list_id: 'front_sl_o0', code, sort_order: 100, created_by: 'usr_1', origin_item_id: origin,
      });
      await db('selection_list_items').insert([item('front_sli_o1', 'A', 'front_sli_src_1'), item('front_sli_o2', 'B', 'front_sli_src_2')]);
      await db('selection_list_items').insert([item('front_sli_o3', 'C', null), item('front_sli_o4', 'D', null)]);
      await expectCode(db('selection_list_items').insert(item('front_sli_o5', 'E', 'front_sli_src_1')), '23505');
    });

    it('platform key lookups and org-visible listings use the partial indexes', async () => {
      await db.raw('SET enable_seqscan = off');
      try {
        const plan = async (sql: string) =>
          (await db.raw(`EXPLAIN ${sql}`)).rows.map((r: any) => r['QUERY PLAN']).join('\n');
        expect(await plan(`SELECT id FROM selection_lists WHERE visibility = 'platform' AND key = 'colors'`)).toMatch(/ix_sl_platform_key/);
        expect(
          await plan(`SELECT id FROM selection_lists WHERE visibility = 'org' AND organization_id = 'org_1' AND status = 'active'`),
        ).toMatch(/ix_sl_org_visible/);
        expect(
          await plan(`SELECT id FROM selection_lists WHERE organization_id = 'org_a' AND forked_from_list_id = 'front_sl_src'`),
        ).toMatch(/ux_sl_fork_per_org/);
        expect(
          await plan(`SELECT id FROM selection_list_items WHERE list_id = 'front_sl_o0' AND origin_item_id = 'front_sli_src_1'`),
        ).toMatch(/ux_sli_origin/);
      } finally {
        await db.raw('RESET enable_seqscan');
      }
    });
  });

  it('down() removes exactly what up() added and up() re-applies cleanly', async () => {
    const db = await fresh();
    await db.migrate.latest();
    await db('selection_lists').insert({ id: 'front_sl_d0', organization_id: 'org_1', key: 'k', created_by: 'usr_1', visibility: 'org' });
    await db.migrate.down(); // 14 (rollout marks)
    await db.migrate.down(); // 13 (suspended_at)
    await db.migrate.down(); // 12 (owner_uuid)
    await db.migrate.down(); // 11 (this migration)
    expect(await columns(db, 'selection_lists')).not.toContain('visibility');
    expect(await columns(db, 'selection_lists')).not.toContain('forked_from_list_id');
    expect(await columns(db, 'selection_list_items')).not.toContain('origin_item_id');
    expect(await indexes(db, 'selection_lists')).not.toContain('ux_sl_fork_per_org');
    // earlier migrations are untouched
    expect(await columns(db, 'selection_lists')).toEqual(expect.arrayContaining(['revision', 'seed_source', 'key']));
    const cons = await db.raw(`SELECT conname FROM pg_constraint WHERE conrelid = 'selection_lists'::regclass AND conname LIKE 'ck_sl_%'`);
    expect(cons.rows.map((r: any) => r.conname).sort()).toEqual(['ck_sl_revision_positive', 'ck_sl_seed_all_or_none', 'ck_sl_seed_modified_needs_seed']);
    const [, applied] = await db.migrate.latest();
    expect(applied).toEqual(['20261005_000011_shared_lists_and_forks.ts', '20261014_000012_ref_index_owner_uuid.ts', '20261015_000013_ref_index_suspended.ts', '20261026_000014_rollout_marks.ts']);
    // the row survives a down/up as private (the visibility value is not preserved by a down)
    expect((await db('selection_lists').where({ id: 'front_sl_d0' }).first()).visibility).toBe('private');
  });

  it('up() twice is a no-op (IF NOT EXISTS / guarded constraints)', async () => {
    const db = await fresh();
    await db.migrate.latest();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(MIGRATIONS_DIR, '20261005_000011_shared_lists_and_forks.ts'));
    await mod.up(db);
    await mod.up(db);
    const cons = await db.raw(`SELECT conname FROM pg_constraint WHERE conrelid = 'selection_lists'::regclass AND conname LIKE 'ck_sl_%'`);
    expect(cons.rows).toHaveLength(6);
  });
});
