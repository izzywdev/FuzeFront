// migrate.test.ts — the chat-db-migrate Job entrypoint.
//
// The Job is the only thing that creates chat_conversations / chat_messages /
// chat_audit_log / chat_feedback, so its contract matters: it must delegate to
// knex's own migrate.latest() (idempotent, tracks applied names in
// knex_migrations) and surface the applied list to the caller.

const migrateLatest = jest.fn();

jest.mock('../../src/db/index', () => ({
  db: {
    migrate: { latest: migrateLatest },
    destroy: jest.fn().mockResolvedValue(undefined),
  },
}));

import { run } from '../../src/db/migrate';

describe('chat-db-migrate entrypoint', () => {
  beforeEach(() => {
    migrateLatest.mockReset();
  });

  it('returns the names of the migrations it applied', async () => {
    migrateLatest.mockResolvedValue([
      1,
      ['001_create_chat_tables.js', '002_multi_app_scope_and_pagination.js'],
    ]);

    await expect(run()).resolves.toEqual([
      '001_create_chat_tables.js',
      '002_multi_app_scope_and_pagination.js',
    ]);
    expect(migrateLatest).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the schema is already current (idempotent re-run)', async () => {
    // knex reports an empty batch when nothing is pending — the normal result on
    // every upgrade after the first, since the Job re-runs as a pre-upgrade hook.
    migrateLatest.mockResolvedValue([0, []]);
    await expect(run()).resolves.toEqual([]);
  });

  it('propagates a migration failure instead of resolving', async () => {
    // Must reject so main() exits non-zero: a swallowed error would let the
    // pre-upgrade hook "succeed" and chat-service start against no schema.
    migrateLatest.mockRejectedValue(new Error('relation "chat_conversations" already exists'));
    await expect(run()).rejects.toThrow('relation "chat_conversations" already exists');
  });
});
