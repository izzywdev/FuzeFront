import { Knex, knex } from 'knex'
import path from 'path'
import { Client } from 'pg'

// Database credentials for FuzeFront dedicated user
const FUZEFRONT_USER = 'fuzefront_user'
const FUZEFRONT_PASSWORD = 'FuzeFront_2024_SecureDB_Pass!'

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
    const dbPassword = ensurePasswordString(process.env.DB_PASSWORD || FUZEFRONT_PASSWORD)

    console.log(`🔧 Database config: User=${dbUser}, Password type=${typeof dbPassword}, Host=${process.env.DB_HOST || 'localhost'}`)

    const connectionConfig: any = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'fuzefront_platform',
      user: dbUser,
    }

    // Only add password if it exists
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
      },
      seeds: {
        directory: path.join(__dirname, isProduction ? '../seeds' : '../seeds'),
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
      },
      seeds: {
        directory: path.join(__dirname, isProduction ? '../seeds' : '../seeds'),
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
  const dbPassword = ensurePasswordString(process.env.DB_PASSWORD || FUZEFRONT_PASSWORD)

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
  console.log('🔧 Ensuring database exists...')

  const dbUser = process.env.DB_USER || FUZEFRONT_USER
  const dbPassword = ensurePasswordString(process.env.DB_PASSWORD || FUZEFRONT_PASSWORD)

  const clientConfig: any = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres', // Connect to default database
    user: dbUser,
  }

  // Only add password if it exists
  if (dbPassword) {
    clientConfig.password = dbPassword
  }

  const client = new Client(clientConfig)

  try {
    await client.connect()

    // Check if database exists
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [process.env.DB_NAME || 'fuzefront_platform']
    )

    if (result.rows.length === 0) {
      console.log(
        `📦 Creating database "${process.env.DB_NAME || 'fuzefront_platform'}"...`
      )
      await client.query(
        `CREATE DATABASE "${process.env.DB_NAME || 'fuzefront_platform'}"`
      )
      console.log('✅ Database created successfully!')
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

  try {
    const [log] = await db.seed.run()

    if (log.length === 0) {
      console.log('✅ No seeds to run')
    } else {
      console.log(`✅ Ran ${log.length} seed(s):`)
      log.forEach((seed: string) => {
        console.log(`  - ${seed}`)
      })
    }
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  }
}

export async function initializeDatabase(): Promise<void> {
  console.log('🏗️  Initializing database...')

  try {
    // Initialize database connection
    initializeDatabaseConnection()

    // Wait for PostgreSQL to be available
    await waitForPostgres()

    // Ensure database exists
    await ensureDatabase()

    // Run migrations
    await runMigrations()

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
  if (db) {
    await db.destroy()
    console.log('🔌 Database connection closed')
  }
} 