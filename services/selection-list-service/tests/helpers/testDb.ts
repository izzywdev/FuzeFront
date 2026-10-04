// Shared real-Postgres harness for the outbox tests.
//
// Each suite creates its OWN schema (search_path pinned on every pooled
// connection), runs the REAL migrations into it, and drops it afterwards, so it
// can share a database with anything else (same approach as
// tests/handlers.db.test.ts).
//
// Where it runs: CI sets SLS_TEST_DATABASE_URL (postgres service container) and
// CI=true; there a missing DB is a FAILURE, never a skip. Locally without
// SLS_TEST_DATABASE_URL the DB-backed suites are skipped with a loud warning.

import knexFactory, { Knex } from 'knex';
import path from 'path';
import { randomBytes } from 'crypto';

export const DB_URL = process.env.SLS_TEST_DATABASE_URL;
export const IN_CI = Boolean(process.env.CI);

/** `describe` when a DB is available (or required by CI), else `describe.skip`. */
export const dbDescribe: jest.Describe = DB_URL || IN_CI ? describe : describe.skip;

if (!DB_URL) {
  if (IN_CI) {
    describe('outbox db tests (CI requires a database)', () => {
      it('SLS_TEST_DATABASE_URL must be set in CI - the DB-backed outbox tests are not optional', () => {
        throw new Error('SLS_TEST_DATABASE_URL is not set but CI=true: add the postgres service to the unit job.');
      });
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn('[outbox tests] DB-backed suites SKIPPED: set SLS_TEST_DATABASE_URL to run them.');
  }
}

export interface TestDb {
  db: Knex;
  schema: string;
  drop: () => Promise<void>;
}

export async function createTestDb(poolMax = 8): Promise<TestDb> {
  const schema = `slo_${randomBytes(6).toString('hex')}`;
  const admin = knexFactory({ client: 'pg', connection: DB_URL, pool: { min: 1, max: 1 } });
  await admin.raw(`CREATE SCHEMA ${schema}`);
  await admin.destroy();

  const db = knexFactory({
    client: 'pg',
    connection: DB_URL,
    searchPath: [schema],
    pool: { min: 1, max: poolMax },
    migrations: {
      directory: path.join(__dirname, '..', '..', 'src', 'db', 'migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  });
  await db.migrate.latest();

  return {
    db,
    schema,
    drop: async () => {
      await db.destroy();
      const a = knexFactory({ client: 'pg', connection: DB_URL, pool: { min: 1, max: 1 } });
      await a.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await a.destroy();
    },
  };
}
