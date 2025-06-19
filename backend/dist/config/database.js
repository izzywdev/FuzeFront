'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.checkDatabaseHealth =
  exports.closeDatabase =
  exports.initializeDatabase =
  exports.db =
    void 0
const knex_1 = require('knex')
const path_1 = __importDefault(require('path'))
// Database configuration based on environment
const getDatabaseConfig = () => {
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
        directory: path_1.default.join(
          __dirname,
          isProduction ? '../migrations' : '../migrations'
        ),
        extension: isProduction ? 'js' : 'ts',
      },
      seeds: {
        directory: path_1.default.join(
          __dirname,
          isProduction ? '../seeds' : '../seeds'
        ),
      },
    }
  } else {
    // SQLite configuration (fallback)
    return {
      client: 'sqlite3',
      connection: {
        filename: path_1.default.join(__dirname, '../database.sqlite'),
      },
      useNullAsDefault: true,
      migrations: {
        tableName: 'knex_migrations',
        directory: path_1.default.join(
          __dirname,
          isProduction ? '../migrations' : '../migrations'
        ),
        extension: isProduction ? 'js' : 'ts',
      },
      seeds: {
        directory: path_1.default.join(
          __dirname,
          isProduction ? '../seeds' : '../seeds'
        ),
      },
    }
  }
}
// Create database instance
exports.db = (0, knex_1.knex)(getDatabaseConfig())
// Database initialization and migration runner
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database connection...')
    // Test the connection
    await exports.db.raw('SELECT 1')
    console.log('✅ Database connection established')
    // Check if we need to run migrations
    console.log('🔄 Checking database schema...')
    const migrationConfig = getDatabaseConfig()
    const migrationsExists = await exports.db.schema.hasTable('knex_migrations')
    if (!migrationsExists) {
      console.log('📦 Database schema not found. Running initial migrations...')
      await exports.db.migrate.latest()
      console.log('✅ Database migrations completed')
      console.log('🌱 Running database seeds...')
      await exports.db.seed.run()
      console.log('✅ Database seeds completed')
    } else {
      console.log('🔄 Running pending migrations...')
      const [batch, migrations] = await exports.db.migrate.latest()
      if (migrations.length === 0) {
        console.log('✅ Database schema is up to date')
      } else {
        console.log(`✅ Ran ${migrations.length} migrations in batch ${batch}`)
        migrations.forEach(migration => {
          console.log(`  - ${migration}`)
        })
      }
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}
exports.initializeDatabase = initializeDatabase
// Graceful shutdown
const closeDatabase = async () => {
  try {
    await exports.db.destroy()
    console.log('✅ Database connection closed')
  } catch (error) {
    console.error('❌ Error closing database connection:', error)
  }
}
exports.closeDatabase = closeDatabase
// Health check function
const checkDatabaseHealth = async () => {
  try {
    await exports.db.raw('SELECT 1')
    return true
  } catch (error) {
    console.error('❌ Database health check failed:', error)
    return false
  }
}
exports.checkDatabaseHealth = checkDatabaseHealth
exports.default = exports.db
//# sourceMappingURL=database.js.map
