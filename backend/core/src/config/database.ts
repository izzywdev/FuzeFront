import { Knex, knex } from 'knex'
import { Client } from 'pg'

// Default DB username (non-secret). The password MUST be supplied via the
// DB_PASSWORD environment variable (e.g. k8s secret / .env) — never hardcoded.
const FUZEFRONT_USER = 'fuzefront_user'

// Helper function to ensure password is always a string
const ensurePasswordString = (password: any): string | undefined => {
  if (password === null || password === undefined || password === '') {
    return undefined
  }
  const strPassword = String(password)
  if (strPassword === 'undefined' || strPassword === 'null') {
    return undefined
  }
  return strPassword
}

/**
 * Options each service passes so it can own its own migrations table + dirs.
 *
 * - `migrationsTableName` — per-service knex migrations table. Defaults to
 *   'knex_migrations' (security-service keeps the original chain's table;
 *   applications-service passes 'knex_migrations_apps').
 * - `migrationsDir` / `seedsDir` — absolute paths to the SERVICE's migration
 *   and seed directories. Because @fuzefront/core is compiled into each
 *   service's node_modules, it cannot derive these from its own __dirname — the
 *   consuming service must supply them (e.g. path.join(__dirname, '../migrations')).
 */
export interface DatabaseConfigOptions {
  migrationsTableName?: string
  migrationsDir?: string
  seedsDir?: string
}

// Module-level config used by the singleton `db` instance + helpers.
let dbOptions: DatabaseConfigOptions = {}

export function getDatabaseConfig(
  options: DatabaseConfigOptions = {}
): Knex.Config {
  const opts = { ...dbOptions, ...options }
  const isProduction = process.env.NODE_ENV === 'production'
  const usePostgres = process.env.USE_POSTGRES === 'true' || !isProduction

  const tableName = opts.migrationsTableName || 'knex_migrations'
  const migrationsConfig: Knex.Config['migrations'] = {
    tableName,
    // Only load the compiled .js (or .ts in dev). Without this, knex's default
    // loadExtensions also matches the emitted .d.ts declaration files in
    // dist/migrations and require()s them -> "Unexpected token 'export'".
    loadExtensions: [isProduction ? '.js' : '.ts'],
    extension: isProduction ? 'js' : 'ts',
    // The split services share the original `knex_migrations` table but ship
    // divergent chains (the monolith recorded `010_add_billing_to_entities`,
    // while security renumbered to `010_create_api_tokens` + `011_add_billing`).
    // knex's default validateMigrationList aborts boot when the table records a
    // migration absent from this image's dir. All service migrations are written
    // idempotently (hasTable/hasColumn guards), so it is safe to skip that strict
    // check and let each service re-apply its own (no-op) chain.
    disableMigrationsListValidation: true,
  }
  if (opts.migrationsDir) {
    migrationsConfig.directory = opts.migrationsDir
  }
  const seedsConfig: Knex.Config['seeds'] = {
    loadExtensions: [isProduction ? '.js' : '.ts'],
  }
  if (opts.seedsDir) {
    seedsConfig.directory = opts.seedsDir
  }

  if (usePostgres) {
    const dbUser = process.env.DB_USER || FUZEFRONT_USER
    const dbPassword = ensurePasswordString(process.env.DB_PASSWORD)

    console.log(
      `🔧 Database config: User=${dbUser}, Password type=${typeof dbPassword}, Host=${process.env.DB_HOST || 'localhost'}, migrationsTable=${tableName}`
    )

    const connectionConfig: any = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'fuzefront_platform',
      user: dbUser,
    }
    if (dbPassword) {
      connectionConfig.password = dbPassword
    }

    return {
      client: 'pg',
      connection: connectionConfig,
      pool: { min: 2, max: 10 },
      migrations: migrationsConfig,
      seeds: seedsConfig,
    }
  }

  // SQLite fallback
  return {
    client: 'sqlite3',
    connection: {
      filename: ':memory:',
    },
    useNullAsDefault: true,
    migrations: migrationsConfig,
    seeds: seedsConfig,
  }
}

// Singleton runtime database instance, shared by the service's route handlers.
export let db: Knex

/**
 * Initialize the module-level options so subsequent helper calls (runMigrations,
 * runSeeds, initializeDatabaseConnection) use the service's table/dirs without
 * having to thread the options through every call site.
 */
export function configureDatabase(options: DatabaseConfigOptions): void {
  dbOptions = { ...options }
}

export function initializeDatabaseConnection(
  options: DatabaseConfigOptions = {}
): void {
  db = knex(getDatabaseConfig(options))
}

export async function waitForPostgres(
  maxRetries = 30,
  retryDelay = 2000
): Promise<void> {
  console.log('🔍 Checking PostgreSQL availability...')

  const dbUser = process.env.DB_USER || FUZEFRONT_USER
  const dbPassword = ensurePasswordString(process.env.DB_PASSWORD)

  for (let i = 0; i < maxRetries; i++) {
    try {
      const clientConfig: any = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: 'postgres',
        user: dbUser,
      }
      if (dbPassword) {
        clientConfig.password = dbPassword
      }

      const client = new Client(clientConfig)
      await client.connect()
      await client.query('SELECT 1')
      await client.end()

      console.log(`✅ PostgreSQL is ready! (Connected as: ${dbUser})`)
      return
    } catch (error) {
      console.log(
        `⏳ Waiting for PostgreSQL... (attempt ${i + 1}/${maxRetries}) [User: ${dbUser}]`
      )
      if (i === maxRetries - 1) {
        throw new Error(
          `Failed to connect to PostgreSQL after ${maxRetries} attempts: ${error}`
        )
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }
}

/**
 * Poll the application database until a given table exists. Used by
 * applications-service so it does not run its `organization_id` FK migration
 * before security-service has created the `organizations` table on a fresh
 * cluster. In-process — no initContainer involved.
 */
export async function waitForTable(
  tableName: string,
  maxRetries = 60,
  retryDelay = 2000
): Promise<void> {
  console.log(`🔍 Waiting for table "${tableName}" to exist...`)

  const dbUser = process.env.DB_USER || FUZEFRONT_USER
  const dbPassword = ensurePasswordString(process.env.DB_PASSWORD)

  for (let i = 0; i < maxRetries; i++) {
    const clientConfig: any = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'fuzefront_platform',
      user: dbUser,
    }
    if (dbPassword) {
      clientConfig.password = dbPassword
    }
    const client = new Client(clientConfig)
    try {
      await client.connect()
      const result = await client.query('SELECT to_regclass($1) AS reg', [
        `public.${tableName}`,
      ])
      if (result.rows[0] && result.rows[0].reg) {
        console.log(`✅ Table "${tableName}" exists.`)
        return
      }
    } catch (error) {
      console.log(`⏳ Error checking for table "${tableName}": ${error}`)
    } finally {
      try {
        await client.end()
      } catch {
        /* ignore */
      }
    }
    console.log(
      `⏳ Waiting for table "${tableName}"... (attempt ${i + 1}/${maxRetries})`
    )
    if (i === maxRetries - 1) {
      throw new Error(
        `Table "${tableName}" did not appear after ${maxRetries} attempts`
      )
    }
    await new Promise(resolve => setTimeout(resolve, retryDelay))
  }
}

export async function ensureDatabase(): Promise<void> {
  console.log('🔧 Ensuring database exists...')

  const dbUser = process.env.DB_USER || FUZEFRONT_USER
  const dbPassword = ensurePasswordString(process.env.DB_PASSWORD)

  const clientConfig: any = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres',
    user: dbUser,
  }
  if (dbPassword) {
    clientConfig.password = dbPassword
  }

  const client = new Client(clientConfig)

  try {
    await client.connect()
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [process.env.DB_NAME || 'fuzefront_platform']
    )

    if (result.rows.length === 0) {
      console.log(
        `📦 Creating database "${process.env.DB_NAME || 'fuzefront_platform'}"...`
      )
      try {
        await client.query(
          `CREATE DATABASE "${process.env.DB_NAME || 'fuzefront_platform'}"`
        )
        console.log('✅ Database created successfully!')
      } catch (createError: any) {
        // 42P04 = duplicate_database; 23505 = unique_violation on pg_database.
        if (createError?.code === '42P04' || createError?.code === '23505') {
          console.log('✅ Database already exists (created concurrently)')
        } else {
          throw createError
        }
      }
    } else {
      console.log('✅ Database already exists')
    }
  } catch (error) {
    console.error('❌ Error ensuring database:', error)
    throw error
  } finally {
    await client.end()
  }
}

export async function runMigrations(
  options: DatabaseConfigOptions = {}
): Promise<void> {
  console.log('🚀 Running database migrations...')

  const migrationDb = knex(getDatabaseConfig(options))

  try {
    const [batchNo, log] = await migrationDb.migrate.latest()

    if (log.length === 0) {
      console.log('✅ Database is already up to date')
    } else {
      console.log(`✅ Ran ${log.length} migration(s):`)
      log.forEach((migration: string) => console.log(`  - ${migration}`))
      console.log(`📦 Batch: ${batchNo}`)
    }
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await migrationDb.destroy()
  }
}

export async function runSeeds(
  options: DatabaseConfigOptions = {}
): Promise<void> {
  console.log('🌱 Running database seeds...')

  const seedDb = db ?? knex(getDatabaseConfig(options))
  try {
    const [log] = await seedDb.seed.run()

    if (log.length === 0) {
      console.log('✅ No seeds to run')
    } else {
      console.log(`✅ Ran ${log.length} seed(s):`)
      log.forEach((seed: string) => console.log(`  - ${seed}`))
    }
  } catch (error) {
    console.warn('⚠️ Seeding skipped (non-fatal):', (error as Error).message)
  } finally {
    if (seedDb !== db) await seedDb.destroy()
  }
}

/**
 * Full in-process bootstrap used by services that own schema (security,
 * applications). The thin backend must NOT call this — it owns no schema and
 * only needs waitForPostgres + initializeDatabaseConnection + checkDatabaseHealth.
 */
export async function initializeDatabase(
  options: DatabaseConfigOptions = {}
): Promise<void> {
  console.log('🔧 Initializing database...')

  if (Object.keys(options).length > 0) {
    configureDatabase(options)
  }

  try {
    await waitForPostgres(30, 2000)
    await ensureDatabase()
    await runMigrations(options)
    initializeDatabaseConnection(options)

    if (process.env.NODE_ENV !== 'production') {
      await runSeeds(options)
    }

    console.log('✅ Database initialization complete!')
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.raw('SELECT 1')
    return true
  } catch (error) {
    console.error('❌ Database health check failed:', error)
    return false
  }
}

export async function closeDatabase(): Promise<void> {
  try {
    await db.destroy()
    console.log('✅ Database connection closed')
  } catch (error) {
    console.error('❌ Error closing database:', error)
  }
}
