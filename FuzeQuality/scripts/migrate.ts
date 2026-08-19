import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const pool = new pg.Pool({ connectionString: databaseUrl })
const directory = resolve('db/migrations')

try {
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), 'utf8')
    await pool.query(sql)
    console.log(`Applied ${file}`)
  }
} finally {
  await pool.end()
}
