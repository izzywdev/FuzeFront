/**
 * Database helpers for the selection-list-service test suite.
 *
 * Connection config via env:
 *   TEST_DB_URL   — full Postgres DSN
 *   DB_HOST       — defaults to localhost
 *   DB_PORT       — defaults to 5432
 *   DB_NAME       — defaults to selection_list_service_test
 *   DB_USER       — defaults to postgres
 *   DB_PASSWORD   — defaults to postgres
 */
import { Pool, type PoolClient } from 'pg';
import { canonicalUuid } from './ids';

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env['TEST_DB_URL'];
    if (connectionString) {
      _pool = new Pool({ connectionString });
    } else {
      _pool = new Pool({
        host: process.env['DB_HOST'] ?? 'localhost',
        port: Number(process.env['DB_PORT'] ?? 5432),
        database: process.env['DB_NAME'] ?? 'selection_list_service_test',
        user: process.env['DB_USER'] ?? 'postgres',
        password: process.env['DB_PASSWORD'] ?? 'postgres',
      });
    }
  }
  return _pool;
}

export async function getDbClient(): Promise<PoolClient> {
  return getPool().connect();
}

/** Run one read/write query on the test DB (the SAME database the service under test uses). */
export async function dbQuery<T extends Record<string, any> = Record<string, any>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await getDbClient();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

export interface DirectAccessGrant {
  list_id: string;
  user_id: string;
  org_id: string;
  role: string;
  granted_by: string;
}

/**
 * Directly INSERT a row into selection_list_access, bypassing Permit.
 * Used ONLY by mirror-not-authority.test.ts (FFRNT-242).
 */
export async function insertDirectAccessGrant(grant: DirectAccessGrant): Promise<void> {
  const client = await getDbClient();
  try {
    await client.query(
      `INSERT INTO selection_list_access
         (list_id, user_id, org_id, role, granted_by, granted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (list_id, user_id) DO NOTHING`,
      [grant.list_id, grant.user_id, grant.org_id, grant.role, grant.granted_by]
    );
  } finally {
    client.release();
  }
}

/**
 * The `selection_list_access` rows of one list, with `user_id` / `org_id` / `granted_by` reduced to their
 * canonical (bare UUID) form. A grant the SERVICE writes (owner at create, fork, seeded owner, access PUT)
 * stores the TypeID on one service build and the bare UUID on another; comparing these rows against
 * `canonicalUuid(expected)` is valid on both. (Rows the harness INSERTs itself, `insertDirectAccessGrant`,
 * are legal legacy data and are read back verbatim with `dbQuery`.)
 */
export async function canonicalAccessRows(
  listId: string,
): Promise<Array<{ user_id: string; org_id: string; role: string; granted_by: string }>> {
  const rows = await dbQuery<{ user_id: string; org_id: string; role: string; granted_by: string }>(
    'SELECT user_id, org_id, role, granted_by FROM selection_list_access WHERE list_id = $1 ORDER BY user_id',
    [listId],
  );
  return rows.map((r) => ({
    user_id: canonicalUuid(r.user_id),
    org_id: canonicalUuid(r.org_id),
    role: r.role,
    granted_by: canonicalUuid(r.granted_by),
  }));
}

export async function removeDirectAccessGrant(listId: string, userId: string): Promise<void> {
  const client = await getDbClient();
  try {
    await client.query(
      'DELETE FROM selection_list_access WHERE list_id = $1 AND user_id = $2',
      [listId, userId]
    );
  } finally {
    client.release();
  }
}

/** Jest globalSetup stub — connection is managed per-suite. */
export default async function globalSetup(): Promise<void> {
  // no-op
}
