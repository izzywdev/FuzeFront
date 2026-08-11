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

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

export interface DirectAccessGrant {
  list_id: string;
  user_id: string;
  organization_id: string;
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
         (list_id, user_id, organization_id, role, granted_by, granted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (list_id, user_id) DO NOTHING`,
      [grant.list_id, grant.user_id, grant.organization_id, grant.role, grant.granted_by]
    );
  } finally {
    client.release();
  }
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
