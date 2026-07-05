/**
 * Checks whether `userId` may perform `action` on a product resource within a
 * tenant (organization). Mirrors checkPermission() in permission-check.ts but
 * namespaces the resource type to the product.
 *
 * @param product   product key, e.g. 'fuzemarket'
 * @param resource  bare product resource, e.g. 'Listing'
 * @param action    action on that resource, e.g. 'update'
 * @param tenant    organization id the resource belongs to
 * @param resourceKey optional specific resource-instance key
 */
export declare function checkProductPermission(userId: string, product: string, resource: string, action: string, tenant: string, resourceKey?: string, context?: Record<string, any>): Promise<boolean>;
/**
 * Assigns a product role (e.g. FuzeMarket 'seller') to a user within a tenant.
 * Product roles are tenant-scoped, exactly like the platform admin/editor/viewer
 * roles — they're just namespaced to the product.
 */
export declare function assignProductRole(userId: string, product: string, role: string, tenant: string): Promise<boolean>;
/** Unassigns a previously-assigned product role from a user within a tenant. */
export declare function unassignProductRole(userId: string, product: string, role: string, tenant: string): Promise<boolean>;
/**
 * Express middleware factory: require a product permission on a route.
 *
 *   router.patch('/listings/:id',
 *     requireProductPermission('fuzemarket', 'Listing', 'update',
 *       req => req.organizationId, req => req.params.id),
 *     handler)
 */
export declare function requireProductPermission(product: string, resource: string, action: string, getTenant: (req: any) => string, getResourceKey?: (req: any) => string): (req: any, res: any, next: any) => Promise<any>;
//# sourceMappingURL=product-authz.d.ts.map