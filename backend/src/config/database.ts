import { Knex, knex } from 'knex'
import path from 'path'

// Database configuration based on environment
const getDatabaseConfig = (): Knex.Config => {
  const isProduction = process.env.NODE_ENV === 'production'
  const usePostgres = process.env.USE_POSTGRES === 'true' || !isProduction

  if (usePostgres) {
    // PostgreSQL configuration (shared infrastructure)
    return {
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'fuzefront_platform',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      },
      pool: {
        min: 2,
        max: 10,
      },
      migrations: {
        tableName: 'knex_migrations',
        directory: path.join(__dirname, '../migrations'),
        extension: 'ts',
      },
      seeds: {
        directory: path.join(__dirname, '../seeds'),
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
        directory: path.join(__dirname, '../migrations'),
        extension: 'ts',
      },
      seeds: {
        directory: path.join(__dirname, '../seeds'),
      },
    }
  }
}

// Create database instance
export const db = knex(getDatabaseConfig())

// Database initialization and migration runner
export const initializeDatabase = async (): Promise<void> => {
  try {
    console.log('🔄 Initializing database connection...')

    // Test the connection
    await db.raw('SELECT 1')
    console.log('✅ Database connection established')

    // Check if we need to run migrations
    console.log('🔄 Checking database schema...')

    const migrationConfig = getDatabaseConfig()
    const migrationsExists = await db.schema.hasTable('knex_migrations')

    if (!migrationsExists) {
      console.log('📦 Database schema not found. Running initial migrations...')
      await db.migrate.latest()
      console.log('✅ Database migrations completed')

      console.log('🌱 Running database seeds...')
      await db.seed.run()
      console.log('✅ Database seeds completed')
    } else {
      console.log('🔄 Running pending migrations...')
      const [batch, migrations] = await db.migrate.latest()

      if (migrations.length === 0) {
        console.log('✅ Database schema is up to date')
      } else {
        console.log(`✅ Ran ${migrations.length} migrations in batch ${batch}`)
        migrations.forEach((migration: string) => {
          console.log(`  - ${migration}`)
        })
      }
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

// Graceful shutdown
export const closeDatabase = async (): Promise<void> => {
  try {
    await db.destroy()
    console.log('✅ Database connection closed')
  } catch (error) {
    console.error('❌ Error closing database connection:', error)
  }
}

// Health check function
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    await db.raw('SELECT 1')
    return true
  } catch (error) {
    console.error('❌ Database health check failed:', error)
    return false
  }
}

export default db
