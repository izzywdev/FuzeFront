/**
 * Syncs all existing database data to Permit.io
 * This should be run once after Permit.io setup is complete
 */
export declare function syncExistingDataToPermit(): Promise<void>
/**
 * Syncs a single user to Permit.io (useful for new registrations)
 */
export declare function syncSingleUserToPermit(userId: string): Promise<boolean>
/**
 * Syncs a single organization to Permit.io (useful for new organizations)
 */
export declare function syncSingleOrganizationToPermit(
  organizationId: string
): Promise<boolean>
/**
 * Health check for Permit.io connection
 */
export declare function checkPermitConnection(): Promise<boolean>
//# sourceMappingURL=sync-existing-data.d.ts.map
