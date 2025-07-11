import { db } from '../../config/database'
import {
  bulkSyncUsers,
  bulkSyncTenants,
  initialDataSync,
} from './bulk-operations'
import { BackendUser } from './user-sync'
import { Organization } from '../../types/shared'

/**
 * Syncs all existing database data to Permit.io
 * This should be run once after Permit.io setup is complete
 */
export async function syncExistingDataToPermit(): Promise<void> {
  try {
    console.log('🚀 Starting data sync to Permit.io...')

    // 1. Fetch all users from database
    console.log('📥 Fetching users from database...')
    const usersFromDb = await db('users').select('*')

    const users: BackendUser[] = usersFromDb.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      roles: user.roles ? JSON.parse(user.roles) : [],
      username: user.username || user.email.split('@')[0],
      created_at: user.created_at,
      updated_at: user.updated_at,
    }))

    console.log(`Found ${users.length} users`)

    // 2. Fetch all organizations from database
    console.log('📥 Fetching organizations from database...')
    const orgsFromDb = await db('organizations')
      .select('*')
      .where('is_active', true)

    const organizations: Organization[] = orgsFromDb.map(org => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      parent_id: org.parent_id,
      owner_id: org.owner_id,
      type: org.type,
      settings: JSON.parse(org.settings || '{}'),
      metadata: JSON.parse(org.metadata || '{}'),
      is_active: org.is_active,
      created_at: org.created_at,
      updated_at: org.updated_at,
    }))

    console.log(`Found ${organizations.length} organizations`)

    // 3. Fetch all memberships from database
    console.log('📥 Fetching organization memberships from database...')
    const membershipsFromDb = await db('organization_memberships')
      .select('*')
      .where('status', 'active')

    const memberships = membershipsFromDb.map(membership => ({
      userId: membership.user_id,
      organizationId: membership.organization_id,
      role: membership.role as 'owner' | 'admin' | 'member' | 'viewer',
    }))

    console.log(`Found ${memberships.length} active memberships`)

    // 4. Perform the sync
    const results = await initialDataSync({
      users,
      organizations,
      memberships,
    })

    // 5. Report results
    console.log('\n✅ Data sync completed!')
    console.log('📊 Results:')
    console.log(
      `  Users: ${results.users.success} synced, ${results.users.failed} failed`
    )
    console.log(
      `  Tenants: ${results.tenants.success} synced, ${results.tenants.failed} failed`
    )
    console.log(
      `  Role Assignments: ${results.roles.success} synced, ${results.roles.failed} failed`
    )

    const totalSuccess =
      results.users.success + results.tenants.success + results.roles.success
    const totalFailed =
      results.users.failed + results.tenants.failed + results.roles.failed

    if (totalFailed === 0) {
      console.log('🎉 All data synced successfully!')
    } else {
      console.log(
        `⚠️  ${totalFailed} operations failed. Check logs above for details.`
      )
    }
  } catch (error) {
    console.error('❌ Error during data sync:', error)
    throw error
  }
}

/**
 * Syncs a single user to Permit.io (useful for new registrations)
 */
export async function syncSingleUserToPermit(userId: string): Promise<boolean> {
  try {
    console.log(`🔄 Syncing user ${userId} to Permit.io...`)

    // Fetch user data
    const userFromDb = await db('users').where('id', userId).first()
    if (!userFromDb) {
      console.error(`User ${userId} not found in database`)
      return false
    }

    const user: BackendUser = {
      id: userFromDb.id,
      email: userFromDb.email,
      firstName: userFromDb.first_name || '',
      lastName: userFromDb.last_name || '',
      roles: userFromDb.roles ? JSON.parse(userFromDb.roles) : [],
      username: userFromDb.username || userFromDb.email.split('@')[0],
      created_at: userFromDb.created_at,
      updated_at: userFromDb.updated_at,
    }

    // Sync user
    const results = await bulkSyncUsers([user])

    if (results.success === 1) {
      console.log(`✅ User ${userId} synced successfully`)
      return true
    } else {
      console.error(`❌ Failed to sync user ${userId}`)
      return false
    }
  } catch (error) {
    console.error(`Error syncing user ${userId}:`, error)
    return false
  }
}

/**
 * Syncs a single organization to Permit.io (useful for new organizations)
 */
export async function syncSingleOrganizationToPermit(
  organizationId: string
): Promise<boolean> {
  try {
    console.log(`🔄 Syncing organization ${organizationId} to Permit.io...`)

    // Fetch organization data
    const orgFromDb = await db('organizations')
      .where('id', organizationId)
      .first()
    if (!orgFromDb) {
      console.error(`Organization ${organizationId} not found in database`)
      return false
    }

    const organization: Organization = {
      id: orgFromDb.id,
      name: orgFromDb.name,
      slug: orgFromDb.slug,
      parent_id: orgFromDb.parent_id,
      owner_id: orgFromDb.owner_id,
      type: orgFromDb.type,
      settings: JSON.parse(orgFromDb.settings || '{}'),
      metadata: JSON.parse(orgFromDb.metadata || '{}'),
      is_active: orgFromDb.is_active,
      created_at: orgFromDb.created_at,
      updated_at: orgFromDb.updated_at,
    }

    // Sync organization as tenant
    const results = await bulkSyncTenants([organization])

    if (results.success === 1) {
      console.log(`✅ Organization ${organizationId} synced successfully`)
      return true
    } else {
      console.error(`❌ Failed to sync organization ${organizationId}`)
      return false
    }
  } catch (error) {
    console.error(`Error syncing organization ${organizationId}:`, error)
    return false
  }
}

/**
 * Health check for Permit.io connection
 */
export async function checkPermitConnection(): Promise<boolean> {
  try {
    const permit = (await import('../../config/permit')).default

    // Try to list projects to test connection
    await permit.api.projects.list()

    console.log('✅ Permit.io connection successful')
    return true
  } catch (error) {
    console.error('❌ Permit.io connection failed:', error)
    return false
  }
}
