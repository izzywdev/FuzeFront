import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  console.log('🔧 Creating dedicated FuzeFront database user...')
  
  // This migration creates a dedicated user for FuzeFront application
  // It should run using the postgres superuser credentials, then create
  // a restricted user for application use
  
  const username = 'fuzefront_user'
  const password = 'FuzeFront_2024_SecureDB_Pass!'
  const dbName = 'fuzefront_platform'
  
  try {
    // Check if user already exists
    const userExists = await knex.raw(`
      SELECT 1 FROM pg_user WHERE usename = ?
    `, [username])
    
    if (userExists.rows.length === 0) {
      console.log(`📝 Creating user: ${username}`)
      
      // Create the user with password. Postgres DDL does not accept a bound
      // parameter ($1) for the password literal, so inline it (constant value).
      await knex.raw(`
        CREATE USER ?? WITH PASSWORD '${password}'
      `, [username])
      
      console.log(`✅ User ${username} created successfully`)
    } else {
      console.log(`✅ User ${username} already exists`)
      
      // Update password in case it changed (inline literal — see note above).
      await knex.raw(`
        ALTER USER ?? WITH PASSWORD '${password}'
      `, [username])
      
      console.log(`✅ User ${username} password updated`)
    }
    
    // Grant necessary permissions to the user
    console.log(`🔑 Granting permissions to ${username}...`)
    
    // Grant connect privilege to database
    await knex.raw(`
      GRANT CONNECT ON DATABASE ?? TO ??
    `, [dbName, username])
    
    // Grant usage on public schema
    await knex.raw(`
      GRANT USAGE ON SCHEMA public TO ??
    `, [username])
    
    // Grant all privileges on all tables in public schema
    await knex.raw(`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ??
    `, [username])
    
    // Grant all privileges on all sequences in public schema (for auto-increment)
    await knex.raw(`
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ??
    `, [username])
    
    // Grant privileges on future tables and sequences
    await knex.raw(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public 
      GRANT ALL PRIVILEGES ON TABLES TO ??
    `, [username])
    
    await knex.raw(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public 
      GRANT ALL PRIVILEGES ON SEQUENCES TO ??
    `, [username])
    
    console.log(`✅ Permissions granted to ${username}`)
    console.log(`🎉 FuzeFront database user setup complete!`)
    
  } catch (error) {
    console.error(`❌ Error creating FuzeFront user:`, error)
    throw error
  }
}

export async function down(knex: Knex): Promise<void> {
  console.log('🔧 Removing FuzeFront database user...')
  
  const username = 'fuzefront_user'
  
  try {
    // Check if user exists before trying to drop
    const userExists = await knex.raw(`
      SELECT 1 FROM pg_user WHERE usename = ?
    `, [username])
    
    if (userExists.rows.length > 0) {
      console.log(`🗑️ Dropping user: ${username}`)
      
      // Revoke all privileges first
      await knex.raw(`
        REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ??
      `, [username])
      
      await knex.raw(`
        REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ??
      `, [username])
      
      await knex.raw(`
        REVOKE USAGE ON SCHEMA public FROM ??
      `, [username])
      
      await knex.raw(`
        REVOKE CONNECT ON DATABASE fuzefront_platform FROM ??
      `, [username])
      
      // Drop the user
      await knex.raw(`
        DROP USER ??
      `, [username])
      
      console.log(`✅ User ${username} removed successfully`)
    } else {
      console.log(`✅ User ${username} does not exist`)
    }
    
  } catch (error) {
    console.error(`❌ Error removing FuzeFront user:`, error)
    throw error
  }
}