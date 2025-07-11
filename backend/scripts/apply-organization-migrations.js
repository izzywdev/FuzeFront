const { Client } = require('pg')

async function applyOrganizationMigrations() {
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

    // Migration 004: Create organizations table
    console.log('\n🚀 Applying migration 004: Create organizations table')

    // Check if enum type exists, create if not
    const enumCheck = await client.query(`
      SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_type_enum');
    `)

    if (!enumCheck.rows[0].exists) {
      await client.query(`
        CREATE TYPE organization_type_enum AS ENUM ('platform', 'organization');
      `)
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id VARCHAR PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        parent_id VARCHAR REFERENCES organizations(id) ON DELETE CASCADE,
        owner_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type organization_type_enum NOT NULL,
        settings JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
      CREATE INDEX IF NOT EXISTS idx_organizations_parent_id ON organizations(parent_id);
      CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);
      CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations(is_active);
      CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type);
      CREATE INDEX IF NOT EXISTS idx_organizations_created_at ON organizations(created_at);
    `)

    // Migration 005: Create organization memberships table
    console.log(
      '🚀 Applying migration 005: Create organization memberships table'
    )

    // Check if role enum exists
    const roleEnumCheck = await client.query(`
      SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_role_enum');
    `)

    if (!roleEnumCheck.rows[0].exists) {
      await client.query(`
        CREATE TYPE membership_role_enum AS ENUM ('owner', 'admin', 'member', 'viewer');
      `)
    }

    // Check if status enum exists
    const statusEnumCheck = await client.query(`
      SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status_enum');
    `)

    if (!statusEnumCheck.rows[0].exists) {
      await client.query(`
        CREATE TYPE membership_status_enum AS ENUM ('active', 'pending', 'suspended', 'revoked');
      `)
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS organization_memberships (
        id VARCHAR PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        role membership_role_enum NOT NULL,
        status membership_status_enum DEFAULT 'active',
        invited_by VARCHAR REFERENCES users(id),
        invited_at TIMESTAMPTZ,
        joined_at TIMESTAMPTZ,
        permissions JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, organization_id)
      );
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_org_memberships_user_id ON organization_memberships(user_id);
      CREATE INDEX IF NOT EXISTS idx_org_memberships_organization_id ON organization_memberships(organization_id);
      CREATE INDEX IF NOT EXISTS idx_org_memberships_role ON organization_memberships(role);
      CREATE INDEX IF NOT EXISTS idx_org_memberships_status ON organization_memberships(status);
      CREATE INDEX IF NOT EXISTS idx_org_memberships_invited_by ON organization_memberships(invited_by);
      CREATE INDEX IF NOT EXISTS idx_org_memberships_joined_at ON organization_memberships(joined_at);
      CREATE INDEX IF NOT EXISTS idx_org_memberships_created_at ON organization_memberships(created_at);
    `)

    // Migration 006: Update apps table for organizations
    console.log(
      '🚀 Applying migration 006: Update apps table for organizations'
    )

    // Check if visibility enum exists
    const visibilityEnumCheck = await client.query(`
      SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_visibility_enum');
    `)

    if (!visibilityEnumCheck.rows[0].exists) {
      await client.query(`
        CREATE TYPE app_visibility_enum AS ENUM ('private', 'organization', 'public', 'marketplace');
      `)
    }

    await client.query(`
      ALTER TABLE apps 
      ADD COLUMN IF NOT EXISTS organization_id VARCHAR REFERENCES organizations(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS visibility app_visibility_enum DEFAULT 'private',
      ADD COLUMN IF NOT EXISTS marketplace_metadata JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS is_marketplace_approved BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS marketplace_submitted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS marketplace_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS approved_by VARCHAR REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS install_permissions JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS install_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2),
      ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_apps_organization_id ON apps(organization_id);
      CREATE INDEX IF NOT EXISTS idx_apps_visibility ON apps(visibility);
      CREATE INDEX IF NOT EXISTS idx_apps_is_marketplace_approved ON apps(is_marketplace_approved);
      CREATE INDEX IF NOT EXISTS idx_apps_marketplace_submitted_at ON apps(marketplace_submitted_at);
      CREATE INDEX IF NOT EXISTS idx_apps_install_count ON apps(install_count);
      CREATE INDEX IF NOT EXISTS idx_apps_rating ON apps(rating);
    `)

    // Migration 007: Update sessions table for organizations
    console.log(
      '🚀 Applying migration 007: Update sessions table for organizations'
    )
    await client.query(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS active_organization_id VARCHAR REFERENCES organizations(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS organization_context JSONB DEFAULT '{}';
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_active_organization_id ON sessions(active_organization_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions(tenant_id);
    `)

    // Update migration tracking
    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      SELECT '004_create_organizations_table.js', 2, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM knex_migrations WHERE name = '004_create_organizations_table.js');
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      SELECT '005_create_organization_memberships_table.js', 2, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM knex_migrations WHERE name = '005_create_organization_memberships_table.js');
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      SELECT '006_update_apps_for_organizations.js', 2, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM knex_migrations WHERE name = '006_update_apps_for_organizations.js');
    `)

    await client.query(`
      INSERT INTO knex_migrations (name, batch, migration_time)
      SELECT '007_update_sessions_for_organizations.js', 2, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM knex_migrations WHERE name = '007_update_sessions_for_organizations.js');
    `)

    console.log('✅ All organization migrations applied successfully!')
  } catch (error) {
    console.error('❌ Error applying migrations:', error.message)
    console.error(error)
  } finally {
    await client.end()
  }
}

applyOrganizationMigrations()
