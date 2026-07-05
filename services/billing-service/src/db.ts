import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

/**
 * Create a pg.Pool from a connection string (DATABASE_URL).
 */
export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/**
 * Run the billing schema migration SQL.
 * Reads 001_billing_schema.sql and executes it as a single statement batch.
 * The SQL is fully idempotent (IF NOT EXISTS everywhere) so re-running is safe.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const sqlPath = path.join(__dirname, 'migrations', '001_billing_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}
