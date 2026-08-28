import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

export async function runMigrations(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const pool = new pg.Pool({ connectionString: databaseUrl })
  const directory = resolve('db/migrations')

  try {
    // Multiple pods can start at once. Serialising the additive DDL keeps a
    // restart or rollout from racing CREATE/ALTER statements across replicas.
    await pool.query('SELECT pg_advisory_lock(82561314)')
    await pool.query('CREATE SCHEMA IF NOT EXISTS fuzequality')
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fuzequality.schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const applied = new Set((await pool.query<{ name: string }>('SELECT name FROM fuzequality.schema_migrations')).rows.map(row => row.name))
    const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Already applied ${file}`)
        continue
      }
      const sql = await readFile(resolve(directory, file), 'utf8')
      await pool.query('BEGIN')
      try {
        await pool.query(sql)
        await pool.query('INSERT INTO fuzequality.schema_migrations (name) VALUES ($1)', [file])
        await pool.query('COMMIT')
      } catch (error) {
        await pool.query('ROLLBACK').catch(() => undefined)
        throw error
      }
      console.log(`Applied ${file}`)
    }
  } finally {
    await pool.query('SELECT pg_advisory_unlock(82561314)').catch(() => undefined)
    await pool.end()
  }
}

if (process.argv[1]?.replace(/\\\\/g, '/').endsWith('/scripts/migrate.ts')) {
  await runMigrations()
}
