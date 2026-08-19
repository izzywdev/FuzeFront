export interface RoleAssignment {
    user: string;
    role: string;
    tenant: string;
    resource_instance?: string;
}
/**
 * Assigns a role to a user in an organization (tenant)
 */
export declare function assignRoleInPermit(assignment: RoleAssignment): Promise<boolean>;
/**
 * Unassigns a role from a user in an organization (tenant)
 */
export declare function unassignRoleInPermit(assignment: Omit<RoleAssignment, 'resource_instance'>): Promise<boolean>;
/**
 * Lists all role assignments for a user
 */
export declare function getUserRoleAssignments(userId: string, tenantId?: string): Promise<import("permitio").RoleAssignmentRead[]>;
/**
 * Lists all role assignments in a tenant
 */
export declare function getTenantRoleAssignments(tenantId: string): Promise<import("permitio").RoleAssignmentRead[]>;
/**
 * Checks if a user has a specific role in a tenant
 */
export declare function userHasRole(userId: string, role: string, tenantId: string): Promise<boolean>;
/**
 * Assigns organization membership roles based on membership role
 */
export declare function assignOrganizationRole(userId: string, organizationId: string, membershipRole: 'owner' | 'admin' | 'member' | 'viewer'): Promise<boolean>;
/**
 * Updates user role when membership role changes
 */
export declare function updateOrganizationRole(userId: string, organizationId: string, oldRole: string, newRole: string): Promise<boolean>;
//# sourceMappingURL=role-assignment.d.ts.map