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
import { canonicalUuid, renderingsOf } from './ids';

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
 * Directly INSERT a mirror row into selection_list_access, bypassing Permit.
 * Used ONLY by mirror-not-authority.test.ts (FFRNT-242).
 *
 * WHY TWO ROWS. Which rendering of a user the service stores in, and looks up by in, `selection_list_access`
 * differs between service builds: a TypeID (`usr_…`) on one, the bare UUID on another. A row injected in only
 * one form is simply never found by the other build's lookup, so a mirror-not-authority test built on it
 * would pass for the wrong reason - it could not detect a regression where the mirror is wrongly treated as
 * authoritative. The injected grant is therefore written in BOTH renderings (the TypeID row with TypeID
 * `org_id` / `granted_by`, the UUID row with UUID ones; the primary key is `(list_id, user_id)`, so they
 * coexist). Whichever form the service under test keys the mirror by, a consulted mirror would find the row
 * and authorize `user_id`. `removeDirectAccessGrant` and `directAccessRowCount` address the same pair.
 */
export async function insertDirectAccessGrant(grant: DirectAccessGrant): Promise<void> {
  const users = renderingsOf(grant.user_id, 'user');
  const orgs = renderingsOf(grant.org_id, 'organization');
  const grantors = renderingsOf(grant.granted_by, 'user');
  const client = await getDbClient();
  try {
    for (let i = 0; i < users.length; i++) {
      await client.query(
        `INSERT INTO selection_list_access
           (list_id, user_id, org_id, role, granted_by, granted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (list_id, user_id) DO NOTHING`,
        [grant.list_id, users[i], orgs[i] ?? orgs[0], grant.role, grantors[i] ?? grantors[0]]
      );
    }
  } finally {
    client.release();
  }
}

/** How many `selection_list_access` rows of `listId` name `userId` (in any rendering). */
export async function directAccessRowCount(listId: string, userId: string): Promise<number> {
  const rows = await dbQuery<{ n: string }>(
    'SELECT count(*)::text AS n FROM selection_list_access WHERE list_id = $1 AND user_id = ANY($2::text[])',
    [listId, renderingsOf(userId, 'user')],
  );
  return Number(rows[0]?.n ?? 0);
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

/** Remove the mirror row(s) `insertDirectAccessGrant` wrote for `userId`: both renderings. */
export async function removeDirectAccessGrant(listId: string, userId: string): Promise<void> {
  const client = await getDbClient();
  try {
    await client.query(
      'DELETE FROM selection_list_access WHERE list_id = $1 AND user_id = ANY($2::text[])',
      [listId, renderingsOf(userId, 'user')]
    );
  } finally {
    client.release();
  }
}

/** Jest globalSetup stub — connection is managed per-suite. */
export default async function globalSetup(): Promise<void> {
  // no-op
}
