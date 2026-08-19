import permit from '../../config/permit'
import { User } from '../../types/shared'
import { assignRoleInPermit, unassignRoleInPermit } from './role-assignment'

export interface PermitUser {
  key: string
  email?: string
  first_name?: string
  last_name?: string
  attributes?: Record<string, any>
}

// Extended User interface for backend operations
export interface BackendUser extends User {
  username?: string
  created_at?: string
  updated_at?: string
}

/**
 * Syncs a user to Permit.io
 */
export async function syncUserToPermit(user: BackendUser): Promise<boolean> {
  try {
    const permitUser: PermitUser = {
      key: user.id,
      email: user.email,
      first_name:
        user.firstName ||
        user.username?.split(' ')[0] ||
        user.email.split('@')[0],
      last_name:
        user.lastName || user.username?.split(' ').slice(1).join(' ') || '',
      attributes: {
        created_at: user.created_at,
        updated_at: user.updated_at,
        roles: user.roles,
      },
    }

    await permit.api.users.sync(permitUser)
    console.log(`User ${user.id} synced to Permit.io successfully`)
    return true
  } catch (error) {
    console.error(`Error syncing user ${user.id} to Permit.io:`, error)
    return false
  }
}

/**
 * Deletes a user from Permit.io
 */
export async function deleteUserFromPermit(userId: string): Promise<boolean> {
  try {
    await permit.api.users.delete(userId)
    console.log(`User ${userId} deleted from Permit.io successfully`)
    return true
  } catch (error) {
    console.error(`Error deleting user ${userId} from Permit.io:`, error)
    return false
  }
}

/**
 * Gets user data from Permit.io
 */
export async function getUserFromPermit(userId: string) {
  try {
    const user = await permit.api.users.get(userId)
    return user
  } catch (error) {
    console.error(`Error getting user ${userId} from Permit.io:`, error)
    return null
  }
}

/**
 * Syncs a service/API token as a Permit principal and assigns it a role.
 * The Permit principal key is "svc_token:<tokenId>".
 */
export async function syncServiceTokenToPermit(
  tokenId: string,
  orgId: string,
  permitRole: 'viewer' | 'editor' | 'admin'
): Promise<boolean> {
  try {
    await permit.api.users.sync({
      key: `svc_token:${tokenId}`,
      attributes: { is_service_token: true, org_id: orgId },
    })
    await assignRoleInPermit({
      user: `svc_token:${tokenId}`,
      role: permitRole,
      tenant: orgId,
    })
    console.log(`Service token ${tokenId} synced to Permit.io with role ${permitRole} in org ${orgId}`)
    return true
  } catch (error) {
    console.error(`Error syncing service token ${tokenId} to Permit.io:`, error)
    return false
  }
}

/**
 * Removes a service/API token role from Permit.
 * The Permit principal key is "svc_token:<tokenId>".
 */
export async function removeServiceTokenFromPermit(
  tokenId: string,
  orgId: string,
  permitRole: 'viewer' | 'editor' | 'admin'
): Promise<boolean> {
  try {
    await unassignRoleInPermit({
      user: `svc_token:${tokenId}`,
      role: permitRole,
      tenant: orgId,
    })
    console.log(`Service token ${tokenId} removed from Permit.io (role ${permitRole}) in org ${orgId}`)
    return true
  } catch (error) {
    console.error(`Error removing service token ${tokenId} from Permit.io:`, error)
    return false
  }
}

/**
 * Updates user attributes in Permit.io
 */
export async function updateUserInPermit(
  userId: string,
  updates: Partial<PermitUser>
): Promise<boolean> {
  try {
    await permit.api.users.update(userId, updates)
    console.log(`User ${userId} updated in Permit.io successfully`)
    return true
  } catch (error) {
    console.error(`Error updating user ${userId} in Permit.io:`, error)
    return false
  }
}
