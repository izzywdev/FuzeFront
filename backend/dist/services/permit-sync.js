'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.PermitSyncService = void 0
const user_sync_1 = require('../utils/permit/user-sync')
const tenant_management_1 = require('../utils/permit/tenant-management')
const role_assignment_1 = require('../utils/permit/role-assignment')
const database_1 = require('../config/database')
/**
 * Default user permissions template
 * These roles are assigned to new users when they are created
 */
const DEFAULT_USER_ROLES = [
  'organization_viewer', // Default role for new users - can view organizations they're part of
]
/**
 * Default organization permissions template
 * These define the initial setup for new organizations
 */
const DEFAULT_ORG_SETUP = {
  // Default roles that should exist in every organization
  roles: [
    'organization_owner',
    'organization_admin',
    'organization_member',
    'organization_viewer',
    'app_developer',
  ],
  // Default tenant attributes
  attributes: {
    type: 'organization',
    setupComplete: false,
    plan: 'free',
  },
}
/**
 * Service for automatic synchronization with Permit.io
 */
class PermitSyncService {
  /**
   * Sync a new user to Permit.io with default permissions
   * Called when a user is created in Authentik or directly in the system
   */
  static async syncNewUser(userId, userData) {
    var _a
    try {
      console.log(`🔄 Syncing new user to Permit.io: ${userId}`)
      // Get user data from database if not provided
      let userInfo = userData
      if (!userInfo) {
        const userRow = await (0, database_1.db)('users')
          .where('id', userId)
          .first()
        if (!userRow) {
          throw new Error(`User ${userId} not found in database`)
        }
        userInfo = {
          email: userRow.email,
          firstName: userRow.first_name,
          lastName: userRow.last_name,
          attributes: userRow.attributes ? JSON.parse(userRow.attributes) : {},
        }
      }
      // Create BackendUser object for sync
      const backendUser = {
        id: userId,
        email: userInfo.email || '',
        firstName: userInfo.firstName || '',
        lastName: userInfo.lastName || '',
        roles: ((_a = userInfo.attributes) === null || _a === void 0
          ? void 0
          : _a.roles) || ['user'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      // Sync user to Permit.io
      await (0, user_sync_1.syncUserToPermit)(backendUser)
      console.log(`✅ User ${userId} synced to Permit.io`)
      // Note: Default role assignment would need to be done when user joins an organization
      // since Permit.io requires a tenant context for role assignments
      console.log(`🎉 User ${userId} fully configured in Permit.io`)
    } catch (error) {
      console.error(`❌ Failed to sync new user ${userId} to Permit.io:`, error)
      // Don't throw - we don't want user creation to fail if Permit.io sync fails
    }
  }
  /**
   * Sync a new organization to Permit.io with default setup
   * Called when an organization is created
   */
  static async syncNewOrganization(orgId, ownerId, orgData) {
    var _a, _b
    try {
      console.log(`🔄 Syncing new organization to Permit.io: ${orgId}`)
      // Get organization data from database if not provided
      let orgInfo = orgData
      if (!orgInfo) {
        const orgRow = await (0, database_1.db)('organizations')
          .where('id', orgId)
          .first()
        if (!orgRow) {
          throw new Error(`Organization ${orgId} not found in database`)
        }
        orgInfo = {
          name: orgRow.name,
          slug: orgRow.slug,
          type: orgRow.type,
          attributes: orgRow.attributes ? JSON.parse(orgRow.attributes) : {},
        }
      }
      // Create organization object for tenant creation
      const organization = {
        id: orgId,
        name: orgInfo.name || `Organization ${orgId}`,
        slug: orgInfo.slug || orgId,
        parent_id: undefined,
        owner_id: ownerId,
        type: orgInfo.type === 'platform' ? 'platform' : 'organization',
        settings:
          ((_a = orgInfo.attributes) === null || _a === void 0
            ? void 0
            : _a.settings) || {},
        metadata:
          ((_b = orgInfo.attributes) === null || _b === void 0
            ? void 0
            : _b.metadata) || {},
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      // Create tenant in Permit.io
      await (0, tenant_management_1.createTenantInPermit)(organization)
      console.log(`✅ Organization ${orgId} synced to Permit.io as tenant`)
      // Assign owner role to the creator
      try {
        await (0, role_assignment_1.assignOrganizationRole)(
          ownerId,
          orgId,
          'owner'
        )
        console.log(
          `✅ Assigned organization_owner role to user ${ownerId} in organization ${orgId}`
        )
      } catch (error) {
        console.error(
          `❌ Failed to assign owner role to user ${ownerId} in organization ${orgId}:`,
          error
        )
      }
      console.log(`🎉 Organization ${orgId} fully configured in Permit.io`)
    } catch (error) {
      console.error(
        `❌ Failed to sync new organization ${orgId} to Permit.io:`,
        error
      )
      // Don't throw - we don't want organization creation to fail if Permit.io sync fails
    }
  }
  /**
   * Sync user membership to an organization
   * Called when a user is added to an organization
   */
  static async syncUserOrganizationMembership(userId, orgId, role = 'member') {
    try {
      console.log(
        `🔄 Syncing user ${userId} membership to organization ${orgId} with role ${role}`
      )
      // Ensure user exists in Permit.io first
      const userRow = await (0, database_1.db)('users')
        .where('id', userId)
        .first()
      if (userRow) {
        await this.syncNewUser(userId, {
          email: userRow.email,
          firstName: userRow.first_name,
          lastName: userRow.last_name,
          attributes: {},
        })
      }
      // Assign role in organization using the organization role mapper
      await (0, role_assignment_1.assignOrganizationRole)(userId, orgId, role)
      console.log(
        `✅ User ${userId} assigned role ${role} in organization ${orgId}`
      )
    } catch (error) {
      console.error(
        `❌ Failed to sync user ${userId} membership to organization ${orgId}:`,
        error
      )
    }
  }
  /**
   * Bulk sync all existing users that aren't in Permit.io yet
   * Useful for initial setup or catching missed syncs
   */
  static async bulkSyncMissingUsers() {
    try {
      console.log(`🔄 Starting bulk sync of missing users to Permit.io`)
      const users = await (0, database_1.db)('users').select('*')
      for (const user of users) {
        try {
          await this.syncNewUser(user.id, {
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            attributes: user.attributes ? JSON.parse(user.attributes) : {},
          })
        } catch (error) {
          console.warn(
            `⚠️  Failed to sync user ${user.id} during bulk sync:`,
            error
          )
        }
      }
      console.log(`✅ Bulk user sync completed`)
    } catch (error) {
      console.error(`❌ Bulk user sync failed:`, error)
    }
  }
  /**
   * Bulk sync all existing organizations that aren't in Permit.io yet
   */
  static async bulkSyncMissingOrganizations() {
    try {
      console.log(`🔄 Starting bulk sync of missing organizations to Permit.io`)
      const organizations = await (0, database_1.db)('organizations').select(
        '*'
      )
      for (const org of organizations) {
        try {
          await this.syncNewOrganization(org.id, org.owner_id, {
            name: org.name,
            slug: org.slug,
            type: org.type,
            attributes: org.attributes ? JSON.parse(org.attributes) : {},
          })
        } catch (error) {
          console.warn(
            `⚠️  Failed to sync organization ${org.id} during bulk sync:`,
            error
          )
        }
      }
      console.log(`✅ Bulk organization sync completed`)
    } catch (error) {
      console.error(`❌ Bulk organization sync failed:`, error)
    }
  }
  /**
   * Bulk sync all existing organization memberships
   */
  static async bulkSyncMissingMemberships() {
    try {
      console.log(`🔄 Starting bulk sync of missing memberships to Permit.io`)
      const memberships = await (0, database_1.db)('organization_memberships')
        .join(
          'organizations',
          'organization_memberships.organization_id',
          'organizations.id'
        )
        .select(
          'organization_memberships.user_id',
          'organization_memberships.organization_id',
          'organization_memberships.role'
        )
      for (const membership of memberships) {
        try {
          await this.syncUserOrganizationMembership(
            membership.user_id,
            membership.organization_id,
            membership.role
          )
        } catch (error) {
          console.warn(
            `⚠️  Failed to sync membership for user ${membership.user_id} in org ${membership.organization_id}:`,
            error
          )
        }
      }
      console.log(`✅ Bulk membership sync completed`)
    } catch (error) {
      console.error(`❌ Bulk membership sync failed:`, error)
    }
  }
  /**
   * Complete sync of all missing data to Permit.io
   * This is the main function to call for initial setup
   */
  static async syncAllMissingData() {
    console.log(`🚀 Starting complete sync of all missing data to Permit.io`)
    await this.bulkSyncMissingUsers()
    await this.bulkSyncMissingOrganizations()
    await this.bulkSyncMissingMemberships()
    console.log(`🎉 Complete data sync finished`)
  }
}
exports.PermitSyncService = PermitSyncService
exports.default = PermitSyncService
//# sourceMappingURL=permit-sync.js.map
