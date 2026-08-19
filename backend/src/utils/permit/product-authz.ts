import permit from '../../config/permit'
import { namespaceKey } from '../../permit/product-policy'

// Runtime authz path for CONSUMER-PRODUCT resources (e.g. FuzeMarket).
//
// Product resources/roles are namespaced (<product>.<Resource>, <product>.<role>)
// when their policy is merged into Permit (see src/permit/product-policy.ts).
// These helpers build the namespaced keys so callers pass the BARE product-local
// names they think in (resource 'Listing', role 'seller') and never hand-format
// the 'fuzemarket.' prefix.

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
export async function checkProductPermission(
  userId: string,
  product: string,
  resource: string,
  action: string,
  tenant: string,
  resourceKey?: string,
  context?: Record<string, any>
): Promise<boolean> {
  try {
    const result = await permit.check(
      userId,
      action,
      {
        type: namespaceKey(product, resource),
        tenant,
        key: resourceKey,
      },
      context
    )
    return result
  } catch (error) {
    console.error(
      `Error checking product permission (${product}.${resource}:${action}):`,
      error
    )
    return false // Fail safe — deny on error.
  }
}

/**
 * Assigns a product role (e.g. FuzeMarket 'seller') to a user within a tenant.
 * Product roles are tenant-scoped, exactly like the platform admin/editor/viewer
 * roles — they're just namespaced to the product.
 */
export async function assignProductRole(
  userId: string,
  product: string,
  role: string,
  tenant: string
): Promise<boolean> {
  try {
    await permit.api.roleAssignments.assign({
      user: userId,
      role: namespaceKey(product, role),
      tenant,
    })
    console.log(
      `Product role ${product}.${role} assigned to user ${userId} in tenant ${tenant}`
    )
    return true
  } catch (error) {
    console.error(
      `Error assigning product role ${product}.${role} to user ${userId}:`,
      error
    )
    return false
  }
}

/** Unassigns a previously-assigned product role from a user within a tenant. */
export async function unassignProductRole(
  userId: string,
  product: string,
  role: string,
  tenant: string
): Promise<boolean> {
  try {
    await permit.api.roleAssignments.unassign({
      user: userId,
      role: namespaceKey(product, role),
      tenant,
    })
    console.log(
      `Product role ${product}.${role} unassigned from user ${userId} in tenant ${tenant}`
    )
    return true
  } catch (error) {
    console.error(
      `Error unassigning product role ${product}.${role} from user ${userId}:`,
      error
    )
    return false
  }
}

/**
 * Express middleware factory: require a product permission on a route.
 *
 *   router.patch('/listings/:id',
 *     requireProductPermission('fuzemarket', 'Listing', 'update',
 *       req => req.organizationId, req => req.params.id),
 *     handler)
 */
export function requireProductPermission(
  product: string,
  resource: string,
  action: string,
  getTenant: (req: any) => string,
  getResourceKey?: (req: any) => string
) {
  return async (req: any, res: any, next: any) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required' })
      }
      const tenant = getTenant(req)
      if (!tenant) {
        return res.status(400).json({ error: 'Organization context required' })
      }
      const resourceKey = getResourceKey ? getResourceKey(req) : undefined
      const allowed = await checkProductPermission(
        req.user.id,
        product,
        resource,
        action,
        tenant,
        resourceKey
      )
      if (!allowed) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: { product, resource, action, tenant },
        })
      }
      next()
    } catch (error) {
      console.error('Product permission middleware error:', error)
      return res.status(500).json({ error: 'Permission check failed' })
    }
  }
}
