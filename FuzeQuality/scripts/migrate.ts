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
    const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = await readFile(resolve(directory, file), 'utf8')
      await pool.query(sql)
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
