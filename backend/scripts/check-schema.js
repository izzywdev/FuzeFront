const { Client } = require('pg')

async function checkSchema() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'fuzefront_platform',
    user: 'postgres',
    password: 'postgres',
  })

  try {
    await client.connect()
    console.log('✅ Connected to PostgreSQL database')

    // Check what tables exist
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `)

    console.log('\n📋 Existing tables:')
    result.rows.forEach(row => {
      console.log(`  - ${row.table_name}`)
    })

    // Check migration status
    const migrationCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'knex_migrations'
      );
    `)

    if (migrationCheck.rows[0].exists) {
      console.log('\n🗃️ Migration tracking table exists')
      const migrations = await client.query(
        'SELECT * FROM knex_migrations ORDER BY id;'
      )
      console.log('\n📝 Applied migrations:')
      migrations.rows.forEach(row => {
        console.log(`  - ${row.name} (batch: ${row.batch})`)
      })
    } else {
      console.log('\n⚠️ No migration tracking table found')
    }
  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await client.end()
  }
}

checkSchema()
