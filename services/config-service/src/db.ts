import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

/** Create a pg.Pool from a connection string (DATABASE_URL). */
export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/**
 * Runs every migrations/*.sql file in lexicographic (numbered) order, each as
 * a single statement batch. Every migration is fully idempotent
 * (IF NOT EXISTS / CHECK-guarded everywhere) so re-running the whole set on
 * every startup is safe — see src/migrations/*.sql.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query(sql);
  }
}
