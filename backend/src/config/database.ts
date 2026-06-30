import { Knex, knex } from 'knex'
import path from 'path'
import { Client } from 'pg'

// Default DB username (non-secret). The password MUST be supplied via the
// DB_PASSWORD environment variable (e.g. k8s secret / .env) — never hardcoded.
const FUZEFRONT_USER = 'fuzefront_user'

// Helper function to ensure password is always a string
const ensurePasswordString = (password: any): string | undefined => {
  if (password === null || password === undefined || password === '') {
    return undefined
  }
  // Convert to string and ensure it's not 'undefined' or 'null' strings
  const strPassword = String(password)
  if (strPassword === 'undefined' || strPassword === 'null') {
    return undefined
  }
  return strPassword
}

// Database configuration
const getDatabaseConfig = (): Knex.Config => {
  const isProduction = process.env.NODE_ENV === 'production'
  const usePostgres = process.env.USE_POSTGRES === 'true' || !isProduction

  if (usePostgres) {
    // PostgreSQL configuration (shared infrastructure)
    const dbUser = process.env.DB_USER || FUZEFRONT_USER
    const dbPassword = ensurePasswordString(process.env.DB_PASSWORD)

    console.log(`🔧 Database config: User=${dbUser}, Password type=${typeof dbPassword}, Host=${process.env.DB_HOST || 'localhost'}`)

    const connectionConfig: any = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'fuzefront_platform',
      user: dbUser,
    }

    // Only add password if it exists and is not null
    if (dbPassword) {
      connectionConfig.password = dbPassword
    }

    return {
      client: 'pg',
      connection: connectionConfig,
      pool: {
        min: 2,
        max: 10,
      },
      migrations: {
        tableName: 'knex_migrations',
        directory: path.join(
          __dirname,
          isProduction ? '../migrations' : '../migrations'
        ),
        extension: isProduction ? 'js' : 'ts',
        // Only load the compiled .js (or .ts in dev). Without this, knex's
        // default loadExtensions also matches the emitted .d.ts declaration
        // files in dist/migrations and require()s them -> "Unexpected token
        // 'export'", which broke migrations on server startup in CI.
        loadExtensions: [isProduction ? '.js' : '.ts'],
        // Backend, security, and applications share this `knex_migrations` table on
        // fuzefront_platform but each image ships only its own migration chain.
        // knex's default validateMigrationList aborts when the table records a
        // migration absent from this image's dir (e.g. security's
        // 010_create_api_tokens / 011_add_billing_to_entities) — which crashlooped
        // backend replicas after security migrated. Migrations are idempotent;
        // skip the strict check so each service tolerates the others' recorded rows.
        disableMigrationsListValidation: true,
      },
      seeds: {
        directory: path.join(__dirname, isProduction ? '../seeds' : '../seeds'),
        loadExtensions: [isProduction ? '.js' : '.ts'],
      },
    }
  } else {
    // SQLite configuration (fallback)
    return {
      client: 'sqlite3',
      connection: {
        filename: path.join(__dirname, '../database.sqlite'),
      },
      useNullAsDefault: true,
      migrations: {
        tableName: 'knex_migrations',
        directory: path.join(
          __dirname,
          isProduction ? '../migrations' : '../migrations'
        ),
        extension: isProduction ? 'js' : 'ts',
        // Only load the compiled .js (or .ts in dev). Without this, knex's
        // default loadExtensions also matches the emitted .d.ts declaration
        // files in dist/migrations and require()s them -> "Unexpected token
        // 'export'", which broke migrations on server startup in CI.
        loadExtensions: [isProduction ? '.js' : '.ts'],
        // Backend, security, and applications share this `knex_migrations` table on
        // fuzefront_platform but each image ships only its own migration chain.
        // knex's default validateMigrationList aborts when the table records a
        // migration absent from this image's dir (e.g. security's
        // 010_create_api_tokens / 011_add_billing_to_entities) — which crashlooped
        // backend replicas after security migrated. Migrations are idempotent;
        // skip the strict check so each service tolerates the others' recorded rows.
        disableMigrationsListValidation: true,
      },
      seeds: {
        directory: path.join(__dirname, isProduction ? '../seeds' : '../seeds'),
        loadExtensions: [isProduction ? '.js' : '.ts'],
      },
    }
  }
}

// Create database instance
export let db: Knex

// Initialize database connection
export function initializeDatabaseConnection(): void {
  db = knex(getDatabaseConfig())
}

// Wait for PostgreSQL to be available
export async function waitForPostgres(
  maxRetries = 30,
  retryDelay = 2000
): Promise<void> {
  console.log('🔍 Checking PostgreSQL availability...')

  const dbUser = process.env.DB_USER || FUZEFRONT_USER
  const dbPassword = ensurePasswordString(process.env.DB_PASSWORD)

  console.log(`🔧 Connection test: User=${dbUser}, Password type=${typeof dbPassword}`)

  for (let i = 0; i < maxRetries; i++) {
    try {
      const clientConfig: any = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: 'postgres', // Connect to default database first
        user: dbUser,
      }

      // Only add password if it exists
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
      console.log(`🔍 Error details: ${error}`)
      if (i === maxRetries - 1) {
        throw new Error(
          `Failed to connect to PostgreSQL after ${maxRetries} attempts: ${error}`
        )
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }
}

export async function ensureDatabase(): Promise<void> {
  // Runtime is least-privilege: it connects as `fuzefront_user`, which has NO
  // CREATEDB. The application database is provisioned out-of-band by the
  // privileged Helm bootstrap Job (deploy/helm/fuzefront/templates/
  // db-bootstrap-job.yaml), which runs as the FuzeInfra Postgres superuser.
  // This function therefore only VERIFIES the database exists and fails fast
  // with an actionable error if the bootstrap step has not run. It never
  // issues CREATE DATABASE.
  console.log('🔧 Verifying application database exists...')

  const dbName = process.env.DB_NAME || 'fuzefront_platform'
  const dbUser = process.env.DB_USER || FUZEFRONT_USER
  const dbPassword = ensurePasswordString(process.env.DB_PASSWORD)

  const clientConfig: any = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres', // Connect to the default DB to probe pg_database
    user: dbUser,
  }

  // Only add password if it exists
  if (dbPassword) {
    clientConfig.password = dbPassword
  }

  const client = new Client(clientConfig)

  try {
    await client.connect()

    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    )

    if (result.rows.length === 0) {
      throw new Error(
        `Application database "${dbName}" does not exist. It must be created ` +
          `by the privileged bootstrap step (Helm pre-install/pre-upgrade Job ` +
          `running as the Postgres superuser) before the backend starts. ` +
          `Runtime connects as a least-privilege role and cannot CREATE DATABASE.`
      )
    }

    console.log(`✅ Database "${dbName}" exists`)
  } catch (error) {
    console.error('❌ Error verifying database:', error)
    throw error
  } finally {
    await client.end()
  }
}

export async function runMigrations(): Promise<void> {
  console.log('🚀 Running database migrations...')

  // Create a temporary database instance
  const migrationDb = knex(getDatabaseConfig())

  try {
    const [batchNo, log] = await migrationDb.migrate.latest()

    if (log.length === 0) {
      console.log('✅ Database is already up to date')
    } else {
      console.log(`✅ Ran ${log.length} migration(s):`)
      log.forEach((migration: string) => {
        console.log(`  - ${migration}`)
      })
      console.log(`📦 Batch: ${batchNo}`)
    }
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await migrationDb.destroy()
  }
}

export async function runSeeds(): Promise<void> {
  console.log('🌱 Running database seeds...')

  // Use a local instance so this works before initializeDatabase() has run
  // (e.g. in the test harness). Seeds are optional test/bootstrap data, so a
  // failure here (e.g. knex can't load .ts seeds under ts-jest) is non-fatal.
  const seedDb = db ?? knex(getDatabaseConfig())
  try {
    const [log] = await seedDb.seed.run()

    if (log.length === 0) {
      console.log('✅ No seeds to run')
    } else {
      console.log(`✅ Ran ${log.length} seed(s):`)
      log.forEach((seed: string) => {
        console.log(`  - ${seed}`)
      })
    }
  } catch (error) {
    console.warn('⚠️ Seeding skipped (non-fatal):', (error as Error).message)
  } finally {
    if (seedDb !== db) await seedDb.destroy()
  }
}

export async function initializeDatabase(): Promise<void> {
  console.log('🔧 Initializing database...')

  try {
    // 1. Wait for PostgreSQL to be available
    await waitForPostgres(30, 2000)

    // 2. Ensure the database exists
    await ensureDatabase()

    // 3. Run migrations
    await runMigrations()

    // 4. Initialize runtime database connection
    initializeDatabaseConnection()

    // 5. Run seeds (only in development)
    if (process.env.NODE_ENV !== 'production') {
      await runSeeds()
    }

    console.log('✅ Database initialization complete!')
    console.log('🎉 Ready to serve requests with fuzefront_user credentials')
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
  if (!db) return

  try {
    // tarn.js pool.destroy() waits indefinitely for borrowed connections to be
    // returned. In tests, fire-and-forget provisioning calls (from
    // selfHealProvisioningOnLogin) may still hold borrowed connections when
    // afterAll runs.  We force-end each borrowed pg client so tarn can
    // immediately release them and pool.destroy() resolves.
    const pool: any = (db as any)?.client?.pool
    if (pool) {
      // pool.used is an Array<{resource, promise}> in tarn.js.
      // The resource IS the raw pg connection (decorated with __knexUid).
      const used: any[] = Array.isArray(pool.used) ? pool.used : []
      if (used.length > 0) {
        console.log(`⚡ Force-ending ${used.length} borrowed DB connection(s)...`)
        await Promise.allSettled(
          used.map((slot: any) => {
            try {
              // Try common shapes: slot.resource (tarn Used<T>), or slot itself
              const conn = slot?.resource ?? slot
              if (conn && typeof conn.end === 'function') {
                return conn.end()
              }
            } catch {
              // best-effort
            }
            return Promise.resolve()
          })
        )
      }
    }

    await db.destroy()
    console.log('✅ Database connection closed')
  } catch (error) {
    console.error('❌ Error closing database:', error)
  }
}
