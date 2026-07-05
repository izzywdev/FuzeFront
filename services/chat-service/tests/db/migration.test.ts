// migration.test.ts — conditional DB migration test.
//
// If a live Postgres instance is reachable (DB_HOST env + DB_PASSWORD set and
// a test DB is available) the test applies up() then down() and asserts table
// existence. Otherwise — the normal CI path — it skips the live round-trip and
// only asserts the migration module exports the correct function signatures.
//
// This test is intentionally non-blocking: CI runs without Postgres.

import * as migration from '../../src/db/migrations/001_create_chat_tables';

const CHAT_TABLES = ['chat_conversations', 'chat_messages', 'chat_audit_log', 'chat_feedback'];

describe('001_create_chat_tables migration module', () => {
  it('exports an up() function', () => {
    expect(typeof migration.up).toBe('function');
  });

  it('exports a down() function', () => {
    expect(typeof migration.down).toBe('function');
  });
});

// Live DB path: only runs when TEST_DB_URL or DB_HOST+DB_PASSWORD are explicitly
// set in the environment (e.g., in a local dev environment with Postgres running).
const liveDbAvailable =
  !!process.env.TEST_DB_URL ||
  (!!process.env.DB_HOST && !!process.env.DB_PASSWORD && process.env.DB_HOST !== 'localhost');

const describeLive = liveDbAvailable ? describe : describe.skip;

describeLive('live DB migration round-trip', () => {
  let knex: import('knex').Knex;

  beforeAll(async () => {
    const knexModule = await import('knex');
    const knexFn = knexModule.default;
    const connection = process.env.TEST_DB_URL
      ? process.env.TEST_DB_URL
      : {
          host: process.env.DB_HOST,
          port: parseInt(process.env.DB_PORT || '5432', 10),
          database: process.env.DB_NAME || 'fuzefront_platform',
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD,
        };
    knex = knexFn({ client: 'pg', connection });
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
  });

  it('up() creates all four chat tables', async () => {
    await migration.up(knex);
    for (const table of CHAT_TABLES) {
      const exists = await knex.schema.hasTable(table);
      expect(exists).toBe(true);
    }
  });

  it('down() drops all four chat tables', async () => {
    await migration.down(knex);
    for (const table of CHAT_TABLES) {
      const exists = await knex.schema.hasTable(table);
      expect(exists).toBe(false);
    }
  });
});
