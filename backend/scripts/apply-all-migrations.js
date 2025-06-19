const { Client } = require('pg')

async function applyAllMigrations() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'fuzefront_platform',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  })

  try {
    await client.connect()
    console.log('✅ Connected to PostgreSQL database')

    // Migration 001: Create users table
    console.log('🚀 Applying migration 001: Create users table')
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      VALUES ('001_create_users_table.js', 1, NOW())
      ON CONFLICT DO NOTHING;
    `)

    // Migration 002: Create apps table
    console.log('🚀 Applying migration 002: Create apps table')
    await client.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        url VARCHAR(500) NOT NULL,
        icon_url VARCHAR(500),
        integration_type VARCHAR(100) NOT NULL DEFAULT 'iframe',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      VALUES ('002_create_apps_table.js', 1, NOW())
      ON CONFLICT DO NOTHING;
    `)

    // Migration 003: Create sessions table
    console.log('🚀 Applying migration 003: Create sessions table')
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(1000) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      VALUES ('003_create_sessions_table.js', 1, NOW())
      ON CONFLICT DO NOTHING;
    `)

    // Migration 004: Create organizations table
    console.log('🚀 Applying migration 004: Create organizations table')

    // Create enum types (if not exists)
    try {
      await client.query(`
        CREATE TYPE organization_type_enum AS ENUM ('organization', 'department', 'team', 'project', 'platform');
      `)
    } catch (error) {
      if (error.code !== '42710') throw error // Ignore "already exists" error
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        parent_id VARCHAR(255) REFERENCES organizations(id) ON DELETE CASCADE,
        owner_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type organization_type_enum NOT NULL,
        settings JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      VALUES ('004_create_organizations_table.js', 2, NOW())
      ON CONFLICT DO NOTHING;
    `)

    // Migration 005: Create organization memberships table
    console.log(
      '🚀 Applying migration 005: Create organization memberships table'
    )

    try {
      await client.query(`
        CREATE TYPE membership_role_enum AS ENUM ('owner', 'admin', 'member', 'viewer');
      `)
    } catch (error) {
      if (error.code !== '42710') throw error // Ignore "already exists" error
    }

    try {
      await client.query(`
        CREATE TYPE membership_status_enum AS ENUM ('active', 'pending', 'suspended', 'left');
      `)
    } catch (error) {
      if (error.code !== '42710') throw error // Ignore "already exists" error
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS organization_memberships (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id VARCHAR(255) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        role membership_role_enum NOT NULL,
        status membership_status_enum DEFAULT 'active',
        invited_by VARCHAR(255) REFERENCES users(id),
        invited_at TIMESTAMP,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        permissions JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, organization_id)
      );
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      VALUES ('005_create_organization_memberships_table.js', 2, NOW())
      ON CONFLICT DO NOTHING;
    `)

    // Migration 006: Update apps table for organizations
    console.log(
      '🚀 Applying migration 006: Update apps table for organizations'
    )

    try {
      await client.query(`
        CREATE TYPE app_visibility_enum AS ENUM ('private', 'organization', 'public', 'marketplace');
      `)
    } catch (error) {
      if (error.code !== '42710') throw error // Ignore "already exists" error
    }

    await client.query(`
      ALTER TABLE apps 
      ADD COLUMN IF NOT EXISTS organization_id VARCHAR(255) REFERENCES organizations(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS visibility app_visibility_enum DEFAULT 'private',
      ADD COLUMN IF NOT EXISTS marketplace_metadata JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS is_marketplace_approved BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS marketplace_submitted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS marketplace_approved_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255) REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS install_permissions JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS install_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0.0,
      ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      VALUES ('006_update_apps_for_organizations.js', 2, NOW())
      ON CONFLICT DO NOTHING;
    `)

    // Migration 007: Update sessions table for organizations
    console.log(
      '🚀 Applying migration 007: Update sessions table for organizations'
    )

    await client.query(`
      ALTER TABLE sessions 
      ADD COLUMN IF NOT EXISTS active_organization_id VARCHAR(255) REFERENCES organizations(id),
      ADD COLUMN IF NOT EXISTS organization_context JSONB DEFAULT '{}';
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      VALUES ('007_update_sessions_for_organizations.js', 2, NOW())
      ON CONFLICT DO NOTHING;
    `)

    console.log('✅ All migrations applied successfully!')

    // Create indexes for performance
    console.log('🚀 Creating database indexes...')

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
      CREATE INDEX IF NOT EXISTS idx_organizations_parent_id ON organizations(parent_id);
      CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);
      CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations(is_active);
      CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type);
      CREATE INDEX IF NOT EXISTS idx_organizations_created_at ON organizations(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_organization_memberships_user_id ON organization_memberships(user_id);
      CREATE INDEX IF NOT EXISTS idx_organization_memberships_organization_id ON organization_memberships(organization_id);
      CREATE INDEX IF NOT EXISTS idx_organization_memberships_role ON organization_memberships(role);
      CREATE INDEX IF NOT EXISTS idx_organization_memberships_status ON organization_memberships(status);
      
      CREATE INDEX IF NOT EXISTS idx_apps_organization_id ON apps(organization_id);
      CREATE INDEX IF NOT EXISTS idx_apps_visibility ON apps(visibility);
      CREATE INDEX IF NOT EXISTS idx_apps_is_marketplace_approved ON apps(is_marketplace_approved);
      
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_active_organization_id ON sessions(active_organization_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `)

    console.log('✅ Database indexes created!')
  } catch (error) {
    console.error('❌ Error applying migrations:', error.message)
    throw error
  } finally {
    await client.end()
  }
}

// Run if called directly
if (require.main === module) {
  applyAllMigrations()
    .then(() => {
      console.log('✅ Database migration complete!')
      process.exit(0)
    })
    .catch(error => {
      console.error('❌ Migration failed:', error)
      process.exit(1)
    })
}

module.exports = { applyAllMigrations }
