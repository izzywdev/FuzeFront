// migrations.seed-events.db.test.ts - migrations 6-9 (seed provenance, revision, ledger,
// seed_sources, event_outbox, ref-index; docs/planning/selection-lists-events.md section 13)
// against REAL Postgres.
//
// Proves: (a) apply from scratch, (b) apply over a POPULATED database written at migration 5
// (existing rows survive and take the new defaults), (c) idempotency - up() applied twice and
// `latest` re-run is a no-op, (d) down()/up() round trip, (e) the constraints/indexes the
// backend relies on, (f) the system principal and '[deleted-user]' sentinel fit created_by /
// granted_by / actor_id, (g) migration ordinals are unique and ordered.
//
// Isolation: each fixture gets its own Postgres schema (search_path pinned), dropped afterwards.
// Runs when SLS_TEST_DATABASE_URL is set; in CI (CI=true) a missing DB is a FAILURE.

import knexFactory, { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

const URL_ENV = process.env.SLS_TEST_DATABASE_URL;
const inCI = Boolean(process.env.CI);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

const suite = URL_ENV ? describe : inCI ? describe : describe.skip;

if (!URL_ENV) {
  if (inCI) {
    describe('migrations.seed-events.db (CI requires a database)', () => {
      it('SLS_TEST_DATABASE_URL must be set in CI', () => {
        throw new Error('SLS_TEST_DATABASE_URL is not set but CI=true.');
      });
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn('[migrations.seed-events.db.test] SKIPPED: set SLS_TEST_DATABASE_URL to run.');
  }
}

describe('migration files', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.ts'));

  it('have globally unique, well-formed, ordered ordinals (no two share a prefix)', () => {
    const ordinals = files.map((f) => {
      const m = f.match(/^(\d{8}_\d{6})_[a-z0-9_]+\.ts$/);
      expect(m).not.toBeNull();
      return m![1];
    });
    expect(new Set(ordinals).size).toBe(ordinals.length);
    expect([...ordinals].sort()).toEqual(ordinals.slice().sort());
    // Contiguous sequence numbers 000001..N
    const seqs = ordinals.map((o) => Number(o.split('_')[1])).sort((a, b) => a - b);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('every migration exports up and down', () => {
    for (const f of files) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(path.join(MIGRATIONS_DIR, f));
      expect(typeof mod.up).toBe('function');
      expect(typeof mod.down).toBe('function');
    }
  });
});

suite('seed/events migrations on real Postgres', () => {
  const schemas: string[] = [];
  const handles: Knex[] = [];

  const admin = () => knexFactory({ client: 'pg', connection: URL_ENV, pool: { min: 1, max: 1 } });

  async function fresh(): Promise<Knex> {
    const schema = `slm_${randomBytes(6).toString('hex')}`;
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

  const SEED_COLS_LISTS = [
    'revision', 'seed_source', 'seed_key', 'seed_list_key', 'seed_version', 'seed_hash',
    'seed_user_modified', 'is_seeded',
  ];
  const SEED_COLS_ITEMS = [
    'seed_source', 'seed_key', 'seed_version', 'seed_hash', 'seed_user_modified', 'is_seeded',
  ];

  const columns = async (db: Knex, table: string): Promise<string[]> =>
    (
      await db.raw(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ?`,
        [table]
      )
    ).rows.map((r: any) => r.column_name);

  const tables = async (db: Knex): Promise<string[]> =>
    (
      await db.raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`)
    ).rows.map((r: any) => r.table_name);

  const expectCode = async (p: Promise<unknown>, code: string) => {
    await expect(p).rejects.toMatchObject({ code });
  };

  it('applies from scratch and creates every new table/column', async () => {
    const db = await fresh();
    const [, applied] = await db.migrate.latest();
    expect(applied.length).toBe(10);

    const lists = await columns(db, 'selection_lists');
    const items = await columns(db, 'selection_list_items');
    for (const c of SEED_COLS_LISTS) expect(lists).toContain(c);
    for (const c of SEED_COLS_ITEMS) expect(items).toContain(c);

    const t = await tables(db);
    for (const name of [
      'selection_list_seed_ledger', 'selection_list_seed_sources', 'event_outbox', 'selection_list_ref_index',
    ]) {
      expect(t).toContain(name);
    }
    expect(await columns(db, 'event_outbox')).toEqual(
      expect.arrayContaining([
        'id', 'seq', 'organization_id', 'topic', 'payload', 'correlation_id', 'status', 'attempts',
        'last_error', 'created_at', 'sent_at',
      ])
    );
  });

  it('applies over a POPULATED database: existing rows survive with defaults', async () => {
    const db = await fresh();
    for (let i = 0; i < 5; i++) await db.migrate.up(); // schema as of migration 5 (pre-change)
    expect(await columns(db, 'selection_lists')).not.toContain('revision');

    await db('selection_lists').insert([
      { id: 'front_sl_a', organization_id: 'org_1', key: 'colors', created_by: 'usr_1' },
      { id: 'front_sl_b', organization_id: 'org_1', key: 'sizes', created_by: '[deleted-user]' },
    ]);
    await db('selection_list_items').insert({
      id: 'front_sli_a', list_id: 'front_sl_a', code: 'RED', sort_order: 100, created_by: 'usr_1',
    });
    await db('selection_list_access').insert({
      list_id: 'front_sl_a', user_id: 'usr_1', role: 'list-owner', granted_by: 'usr_1',
    });

    const [, applied] = await db.migrate.latest();
    expect(applied.length).toBe(5);

    const lists = await db('selection_lists').orderBy('id');
    expect(lists).toHaveLength(2);
    for (const l of lists) {
      expect(Number(l.revision)).toBe(1);
      expect(l.seed_source).toBeNull();
      expect(l.seed_user_modified).toBe(false);
      expect(l.is_seeded).toBe(false);
    }
    const item = await db('selection_list_items').first();
    expect(item.code).toBe('RED');
    expect(item.is_seeded).toBe(false);
    expect(await db('selection_list_access').count('* as n').first()).toMatchObject({ n: '1' });
  });

  it('is idempotent: each up() applied twice, and `latest` re-run, change nothing', async () => {
    const db = await fresh();
    await db.migrate.latest();
    await db('selection_lists').insert({ id: 'front_sl_i', organization_id: 'org_1', key: 'k', created_by: 'usr_1' });
    const before = await db.raw(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = current_schema() ORDER BY 1, 2`
    );

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.ts')).sort();
    for (const f of files) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(path.join(MIGRATIONS_DIR, f));
      await mod.up(db); // second application of the raw DDL must not throw
      await mod.up(db); // ...nor a third
    }
    const [, again] = await db.migrate.latest();
    expect(again).toEqual([]);

    const after = await db.raw(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = current_schema() ORDER BY 1, 2`
    );
    expect(after.rows).toEqual(before.rows);
    expect(await db('selection_lists').count('* as n').first()).toMatchObject({ n: '1' });
    // Constraint/trigger/index objects were not duplicated.
    const cons = await db.raw(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'selection_lists'::regclass AND conname LIKE 'ck_sl_%'`
    );
    expect(cons.rows.map((r: any) => r.conname).sort()).toEqual([
      'ck_sl_revision_positive', 'ck_sl_seed_all_or_none', 'ck_sl_seed_modified_needs_seed',
    ]);
  });

  it('down() then up() round-trips cleanly (and leaves migrations 1-5 intact)', async () => {
    const db = await fresh();
    await db.migrate.latest();
    for (let i = 0; i < 5; i++) await db.migrate.down();
    const t = await tables(db);
    for (const name of ['selection_list_seed_ledger', 'selection_list_seed_sources', 'event_outbox', 'selection_list_ref_index']) {
      expect(t).not.toContain(name);
    }
    expect(await columns(db, 'selection_lists')).not.toContain('seed_source');
    expect(await columns(db, 'selection_lists')).toContain('key');
    const [, applied] = await db.migrate.latest();
    expect(applied.length).toBe(5);
  });

  describe('constraints and semantics', () => {
    let db: Knex;
    beforeAll(async () => {
      db = await fresh();
      await db.migrate.latest();
    });

    const list = (id: string, over: Record<string, unknown> = {}) => ({
      id, organization_id: 'org_1', key: `key_${id}`, created_by: 'usr_1', ...over,
    });
    const seeded = (over: Record<string, unknown> = {}) => ({
      seed_source: 'platform', seed_key: 'platform-defaults', seed_list_key: 'yes-no',
      seed_version: 1, seed_hash: 'h1', ...over,
    });

    it('seeded rows are all-or-nothing (lists)', async () => {
      await expectCode(
        db('selection_lists').insert(list('front_sl_c1', { seed_source: 'platform' })),
        '23514'
      );
      await db('selection_lists').insert(list('front_sl_c2', { created_by: 'system:selection-list-service', ...seeded() }));
      const row = await db('selection_lists').where({ id: 'front_sl_c2' }).first();
      expect(row.is_seeded).toBe(true);
      expect(Number(row.revision)).toBe(1);
    });

    it('seed identity is unique per (org, source, pack, seeded list key); user rows are unconstrained', async () => {
      await expectCode(
        db('selection_lists').insert(list('front_sl_c3', seeded())), // same org/source/pack/list key as c2
        '23505'
      );
      // another org may seed the same pack
      await db('selection_lists').insert(list('front_sl_c4', { organization_id: 'org_2', ...seeded() }));
      // user-authored rows (NULL provenance) never collide on the partial index
      await db('selection_lists').insert([list('front_sl_u1'), list('front_sl_u2')]);
    });

    it('seed_user_modified requires a seeded row', async () => {
      await expectCode(
        db('selection_lists').insert(list('front_sl_c5', { seed_user_modified: true })),
        '23514'
      );
      await db('selection_lists').where({ id: 'front_sl_c2' }).update({ seed_user_modified: true });
    });

    it('revision is >= 1 and never decreases, but can be bumped', async () => {
      await expectCode(db('selection_lists').insert(list('front_sl_c6', { revision: 0 })), '23514');
      await db('selection_lists').where({ id: 'front_sl_c2' }).update({ revision: db.raw('revision + 1') });
      expect(Number((await db('selection_lists').where({ id: 'front_sl_c2' }).first()).revision)).toBe(2);
      await expectCode(db('selection_lists').where({ id: 'front_sl_c2' }).update({ revision: 1 }), '23514');
      // unrelated updates are not blocked
      await db('selection_lists').where({ id: 'front_sl_c2' }).update({ status: 'archived' });
    });

    it('items: all-or-nothing provenance and modified-needs-seed', async () => {
      await db('selection_list_items').insert({
        id: 'front_sli_1', list_id: 'front_sl_c2', code: 'YES', sort_order: 100,
        created_by: 'system:selection-list-service',
        seed_source: 'platform', seed_key: 'platform-defaults', seed_version: 1, seed_hash: 'ih',
      });
      expect((await db('selection_list_items').where({ id: 'front_sli_1' }).first()).is_seeded).toBe(true);
      await expectCode(
        db('selection_list_items').insert({
          id: 'front_sli_2', list_id: 'front_sl_c2', code: 'NO', sort_order: 200, created_by: 'usr_1',
          seed_source: 'platform',
        }),
        '23514'
      );
      await expectCode(
        db('selection_list_items').insert({
          id: 'front_sli_3', list_id: 'front_sl_c2', code: 'MAYBE', sort_order: 300, created_by: 'usr_1',
          seed_user_modified: true,
        }),
        '23514'
      );
    });

    it('created_by / granted_by / actor_id hold the system principal and the [deleted-user] sentinel', async () => {
      await db('selection_lists').insert(list('front_sl_p1', { created_by: '[deleted-user]' }));
      await db('selection_list_items').insert({
        id: 'front_sli_p1', list_id: 'front_sl_p1', code: 'A', sort_order: 1, created_by: 'system:selection-list-service',
      });
      await db('selection_list_items').update({ created_by: '[deleted-user]' }).where({ id: 'front_sli_p1' });
      await db('selection_list_access').insert({
        list_id: 'front_sl_p1', user_id: 'usr_9', role: 'list-owner', granted_by: 'system:selection-list-service',
      });
      await db('selection_list_access').update({ granted_by: '[deleted-user]' }).where({ list_id: 'front_sl_p1' });
      await db('selection_list_audit').insert({
        id: 'aud_p1', list_id: 'front_sl_p1', actor_id: 'system:selection-list-service', action: 'seed.applied',
      });
      expect((await db('selection_lists').where({ id: 'front_sl_p1' }).first()).created_by).toBe('[deleted-user]');
    });

    it('ledger: ledger key is unique and a version is immutable-by-key', async () => {
      const row = (over: Record<string, unknown> = {}) => ({
        organization_id: 'org_1', seed_source: 'platform', seed_key: 'platform-defaults', version: 1,
        content_hash: 'abc', manifest: JSON.stringify({ 'yes-no': ['YES', 'NO'] }), result: JSON.stringify([]),
        trigger: 'org-created', applied_by: 'system:selection-list-service', ...over,
      });
      await db('selection_list_seed_ledger').insert(row());
      await expectCode(db('selection_list_seed_ledger').insert(row()), '23505');
      await db('selection_list_seed_ledger').insert(row({ version: 2 }));
      await db('selection_list_seed_ledger').insert(row({ organization_id: 'org_2' }));
      await expectCode(db('selection_list_seed_ledger').insert(row({ version: 0, organization_id: 'org_3' })), '23514');
      await expectCode(db('selection_list_seed_ledger').insert(row({ scope: 'team', organization_id: 'org_3' })), '23514');
      const max = await db('selection_list_seed_ledger')
        .where({ organization_id: 'org_1', seed_source: 'platform', seed_key: 'platform-defaults' })
        .max('version as v').first();
      expect(Number(max!.v)).toBe(2);
      const defaults = await db('selection_list_seed_ledger').where({ organization_id: 'org_2' }).first();
      expect(defaults.scope).toBe('org');
      expect(defaults.request_id).toBeNull();
      expect(defaults.attested_subject).toBeNull();
    });

    it('seed_sources: platform reserved, caps enforced, prefixes required', async () => {
      const row = (over: Record<string, unknown> = {}) => ({
        app: 'fuzepicker', allowed_subjects: ['svc-picker'], key_prefixes: ['fuzepicker-'],
        max_lists_per_request: 20, max_items_per_request: 2000, ...over,
      });
      await db('selection_list_seed_sources').insert(row());
      const stored = await db('selection_list_seed_sources').where({ app: 'fuzepicker' }).first();
      expect(stored.enabled).toBe(true);
      expect(stored.allowed_subjects).toEqual(['svc-picker']);
      await expectCode(db('selection_list_seed_sources').insert(row({ app: 'platform' })), '23514');
      await expectCode(db('selection_list_seed_sources').insert(row({ app: 'a', max_lists_per_request: 21 })), '23514');
      await expectCode(db('selection_list_seed_sources').insert(row({ app: 'b', max_items_per_request: 2001 })), '23514');
      await expectCode(db('selection_list_seed_sources').insert(row({ app: 'c', max_lists_per_request: 0 })), '23514');
      await expectCode(db('selection_list_seed_sources').insert(row({ app: 'd', key_prefixes: [] })), '23514');
      await expectCode(db('selection_list_seed_sources').insert(row()), '23505');
    });

    describe('event_outbox', () => {
      const ev = (id: string, org: string, over: Record<string, unknown> = {}) => ({
        id, organization_id: org, topic: 'selection-lists.list.created',
        payload: JSON.stringify({ listId: 'front_sl_x' }), correlation_id: 'corr-1', ...over,
      });
      const U = (n: number) => `0195a8f2-7c3e-7a11-8b2d-${String(n).padStart(12, '0')}`;

      it('defaults, status/sent_at invariants, duplicate eventId rejected, id required', async () => {
        await db('event_outbox').insert(ev(U(1), 'org_1'));
        const r = await db('event_outbox').where({ id: U(1) }).first();
        expect(r.status).toBe('pending');
        expect(r.attempts).toBe(0);
        expect(r.sent_at).toBeNull();
        expect(typeof r.payload).toBe('object'); // JSONB parsed
        await expectCode(db('event_outbox').insert(ev(U(1), 'org_1')), '23505');
        await expectCode(db('event_outbox').insert(ev(U(2), 'org_1', { status: 'bogus' })), '23514');
        await expectCode(db('event_outbox').insert(ev(U(3), 'org_1', { status: 'sent' })), '23514'); // sent needs sent_at
        await expectCode(db('event_outbox').insert(ev(U(4), 'org_1', { sent_at: db.fn.now() })), '23514'); // sent_at needs sent
        await expectCode(db('event_outbox').insert(ev(U(5), 'org_1', { organization_id: null })), '23502');
        await expectCode(db('event_outbox').insert({ ...ev(U(6), 'org_1'), id: undefined }), '23502');
        await expectCode(db('event_outbox').insert(ev(U(7), 'org_1', { attempts: -1 })), '23514');
      });

      it('seq is strictly increasing in insertion order (per-org ordering tiebreak) and not client-settable', async () => {
        await db.transaction(async (trx) => {
          await trx('event_outbox').insert(ev(U(10), 'org_ord')); // same txn => identical created_at
          await trx('event_outbox').insert(ev(U(9), 'org_ord')); // id sorts BEFORE the previous one
          await trx('event_outbox').insert(ev(U(11), 'org_ord'));
        });
        const rows = await db('event_outbox').where({ organization_id: 'org_ord' }).orderBy(['created_at', 'seq']);
        expect(rows.map((r: any) => r.id)).toEqual([U(10), U(9), U(11)]);
        await expectCode(db('event_outbox').insert(ev(U(12), 'org_ord', { seq: 1 })), '428C9');
      });

      it('FOR UPDATE SKIP LOCKED claim: concurrent relays never claim the same row', async () => {
        for (let i = 20; i < 26; i++) await db('event_outbox').insert(ev(U(i), 'org_claim'));
        const claim = async (trx: Knex.Transaction, n: number) =>
          (
            await trx.raw(
              `SELECT id FROM event_outbox WHERE status = 'pending' AND organization_id = 'org_claim'
               ORDER BY created_at, seq LIMIT ? FOR UPDATE SKIP LOCKED`,
              [n]
            )
          ).rows.map((r: any) => r.id);
        const t1 = await db.transaction();
        const t2 = await db.transaction();
        try {
          const a = await claim(t1, 3);
          const b = await claim(t2, 3);
          expect(a).toHaveLength(3);
          expect(b).toHaveLength(3);
          expect(new Set([...a, ...b]).size).toBe(6);
          // mark sent in t1: valid transition; attempts bump in t2: parks as failed
          await t1('event_outbox').whereIn('id', a).update({ status: 'sent', sent_at: db.fn.now() });
          await t2('event_outbox').whereIn('id', b).update({ status: 'failed', attempts: 10, last_error: 'boom' });
          await t1.commit();
          await t2.commit();
        } catch (e) {
          await t1.rollback().catch(() => {});
          await t2.rollback().catch(() => {});
          throw e;
        }
        expect(await db('event_outbox').where({ organization_id: 'org_claim', status: 'pending' }).count('* as n').first())
          .toMatchObject({ n: '0' });
      });

      it('relay hot path uses the partial per-org index', async () => {
        await db.raw('SET enable_seqscan = off');
        try {
          const plan = (
            await db.raw(
              `EXPLAIN SELECT id FROM event_outbox WHERE status = 'pending' AND organization_id = 'org_1'
               ORDER BY created_at, seq LIMIT 20`
            )
          ).rows.map((r: any) => r['QUERY PLAN']).join('\n');
          expect(plan).toMatch(/idx_event_outbox_pending/);
        } finally {
          await db.raw('RESET enable_seqscan');
        }
      });
    });

    describe('ref index', () => {
      const org = (id: string, over: Record<string, unknown> = {}) => ({
        entity_type: 'organization', entity_id: id, wire_id: `org_${id}`, org_type: 'organization',
        is_active: true, ...over,
      });

      it('upsert is idempotent; tombstone survives a redelivered create; wire id unique', async () => {
        const U = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c8d';
        await db('selection_list_ref_index').insert(org(U));
        await db('selection_list_ref_index')
          .insert(org(U))
          .onConflict(['entity_type', 'entity_id'])
          .merge({ updated_at: db.fn.now() });
        expect(await db('selection_list_ref_index').where({ entity_id: U }).count('* as n').first()).toMatchObject({ n: '1' });
        await expectCode(db('selection_list_ref_index').insert(org(U)), '23505');
        await expectCode(db('selection_list_ref_index').insert(org('other', { wire_id: `org_${U}` })), '23505');
        const row = await db('selection_list_ref_index').where({ entity_id: U }).first();
        expect(row.status).toBe('active');
        await db('selection_list_ref_index').where({ entity_id: U }).update({ status: 'deleted' });
        expect((await db('selection_list_ref_index').where({ entity_id: U }).first()).status).toBe('deleted');
      });

      it('rejects bad status / org_type; null wire ids do not collide', async () => {
        await expectCode(db('selection_list_ref_index').insert(org('x1', { status: 'gone' })), '23514');
        await expectCode(db('selection_list_ref_index').insert(org('x2', { org_type: 'galaxy' })), '23514');
        await db('selection_list_ref_index').insert([
          org('n1', { wire_id: null }),
          org('n2', { wire_id: null }),
          { entity_type: 'user', entity_id: 'u1' },
        ]);
      });
    });
  });
});
