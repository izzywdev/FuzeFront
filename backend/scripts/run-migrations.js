const knex = require('knex')
const path = require('path')

// Database configuration
const config = {
  client: 'pg',
  connection: {
    host: 'localhost',
    port: 5432,
    database: 'fuzefront_platform',
    user: 'postgres',
    password: 'postgres',
  },
  migrations: {
    directory: path.join(__dirname, '../dist/migrations'),
    extension: 'js',
  },
}

async function runMigrations() {
  console.log('🚀 Running database migrations...')

  const db = knex(config)

  try {
    // Run migrations
    const [batchNo, log] = await db.migrate.latest()

    if (log.length === 0) {
      console.log('✅ Database is already up to date')
    } else {
      console.log(`✅ Ran ${log.length} migration(s):`)
      log.forEach(migration => {
        console.log(`  - ${migration}`)
      })
      console.log(`📦 Batch: ${batchNo}`)
    }
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    console.error(error)
  } finally {
    await db.destroy()
  }
}

runMigrations()
