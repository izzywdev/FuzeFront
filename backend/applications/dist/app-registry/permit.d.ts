export interface PermitResource {
    type: string;
    tenant: string;
    key?: string;
}
export interface PermitLike {
    check: (user: string, action: string, resource: PermitResource, context?: Record<string, unknown>) => Promise<boolean>;
}
/** Test/DI seam — inject a stub authorizer. */
export declare function setPermitClient(c: PermitLike | null): void;
/**
 * Resolves the Permit client. In CI/test (no real PERMIT_API_KEY) we use a
 * no-op DENY client so suites run with no network and no SDK; production loads
 * the real permitio SDK. The real instance is created with throwOnError:false so
 * a PDP outage yields a deny (handled in checkAppRegistryPermission) rather than
 * a thrown 500.
 */
export declare function getPermitClient(): PermitLike;
/**
 * Checks an `apps:*` scope for a user against an App resource scoped to a tenant
 * (organization). Fail-CLOSED on any error. `tenant` falls back to the platform
 * tenant for platform-global (org-less) apps.
 */
export declare function checkAppRegistryPermission(args: {
    userId: string;
    action: 'apps:register' | 'apps:write' | 'apps:activate';
    organizationId?: string | null;
    slug?: string;
    context?: Record<string, unknown>;
}): Promise<boolean>;
//# sourceMappingURL=permit.d.ts.map