const { Client } = require('pg')

async function checkColumnTypes() {
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

    // Check users table structure
    console.log('\n📋 Users table structure:')
    const usersColumns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position;
    `)

    usersColumns.rows.forEach(row => {
      console.log(
        `  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`
      )
    })

    // Check apps table structure
    console.log('\n📋 Apps table structure:')
    const appsColumns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'apps' 
      ORDER BY ordinal_position;
    `)

    appsColumns.rows.forEach(row => {
      console.log(
        `  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`
      )
    })

    // Check sessions table structure
    console.log('\n📋 Sessions table structure:')
    const sessionsColumns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'sessions' 
      ORDER BY ordinal_position;
    `)

    sessionsColumns.rows.forEach(row => {
      console.log(
        `  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`
      )
    })
  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await client.end()
  }
}

checkColumnTypes()
