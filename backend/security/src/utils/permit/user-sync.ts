import permit from '../../config/permit'
import { logger } from '../../lib/logger'
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
    logger.info({ userId: user.id }, 'permit: user synced')
    return true
  } catch (error) {
    logger.error({ userId: user.id, err: error }, 'permit: user sync failed')
    return false
  }
}

/**
 * Deletes a user from Permit.io
 */
export async function deleteUserFromPermit(userId: string): Promise<boolean> {
  try {
    await permit.api.users.delete(userId)
    logger.info({ userId }, 'permit: user deleted')
    return true
  } catch (error) {
    logger.error({ userId, err: error }, 'permit: user delete failed')
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
    logger.error({ userId, err: error }, 'permit: user get failed')
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
    logger.info(
      { tokenId, permitRole, orgId },
      'permit: service token synced and role assigned'
    )
    return true
  } catch (error) {
    logger.error(
      { tokenId, permitRole, orgId, err: error },
      'permit: service token sync failed'
    )
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
    logger.info(
      { tokenId, permitRole, orgId },
      'permit: service token role unassigned'
    )
    return true
  } catch (error) {
    logger.error(
      { tokenId, permitRole, orgId, err: error },
      'permit: service token removal failed'
    )
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
    logger.info({ userId }, 'permit: user updated')
    return true
  } catch (error) {
    logger.error({ userId, err: error }, 'permit: user update failed')
    return false
  }
}
