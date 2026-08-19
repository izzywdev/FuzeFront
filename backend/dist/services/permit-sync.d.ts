/**
 * Service for automatic synchronization with Permit.io
 */
export declare class PermitSyncService {
  /**
   * Sync a new user to Permit.io with default permissions
   * Called when a user is created in Authentik or directly in the system
   */
  static syncNewUser(
    userId: string,
    userData?: {
      email?: string
      firstName?: string
      lastName?: string
      attributes?: Record<string, any>
    }
  ): Promise<void>
  /**
   * Sync a new organization to Permit.io with default setup
   * Called when an organization is created
   */
  static syncNewOrganization(
    orgId: string,
    ownerId: string,
    orgData?: {
      name?: string
      slug?: string
      type?: string
      attributes?: Record<string, any>
    }
  ): Promise<void>
  /**
   * Sync user membership to an organization
   * Called when a user is added to an organization
   */
  static syncUserOrganizationMembership(
    userId: string,
    orgId: string,
    role?: string
  ): Promise<void>
  /**
   * Bulk sync all existing users that aren't in Permit.io yet
   * Useful for initial setup or catching missed syncs
   */
  static bulkSyncMissingUsers(): Promise<void>
  /**
   * Bulk sync all existing organizations that aren't in Permit.io yet
   */
  static bulkSyncMissingOrganizations(): Promise<void>
  /**
   * Bulk sync all existing organization memberships
   */
  static bulkSyncMissingMemberships(): Promise<void>
  /**
   * Complete sync of all missing data to Permit.io
   * This is the main function to call for initial setup
   */
  static syncAllMissingData(): Promise<void>
}
export default PermitSyncService
//# sourceMappingURL=permit-sync.d.ts.map
