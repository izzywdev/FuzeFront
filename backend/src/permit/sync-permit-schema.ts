import { permitSchema, PermitSchema, PermitResourceDef } from './schema'
import { ProductPolicy, buildEnvSchema, validateProductPolicy } from './product-policy'

export { permitSchema } from './schema'
export type { PermitSchema, PermitResourceDef, PermitRoleDef } from './schema'
export {
  mergeProductPolicy,
  namespaceProductPolicy,
  buildEnvSchema,
  namespaceKey,
  validateProductPolicy,
  ProductPolicyError,
  PRODUCT_NS_SEP,
} from './product-policy'
export type { ProductPolicy, ProductResourceDecl, ProductRoleDecl } from './product-policy'

// The slice of the permitio client surface this routine uses. Declared
// structurally so tests can inject a fake without the real SDK / PERMIT_API_KEY.
export interface PermitSchemaClient {
  api: {
    resources: {
      get(key: string): Promise<unknown>
      create(def: unknown): Promise<unknown>
      update(key: string, def: unknown): Promise<unknown>
    }
    roles: {
      get(key: string): Promise<unknown>
      create(def: unknown): Promise<unknown>
      update(key: string, def: unknown): Promise<unknown>
    }
  }
}

// The resource payload we send to Permit on update — name + actions plus the
// optional ReBAC bits (relations between resources, resource-instance-scoped
// roles with derivation). Only included when the resource declares them, so
// existing flat resources are sent unchanged.
function resourceUpdatePayload(resource: PermitResourceDef) {
  const payload: Record<string, unknown> = {
    name: resource.name,
    actions: resource.actions,
  }
  if (resource.relations) payload.relations = resource.relations
  if (resource.roles) payload.roles = resource.roles
  return payload
}

// get-or-(create|update): idempotent and agnostic to SDK error shapes.
export async function syncPermitSchema(
  permit: PermitSchemaClient,
  schema: PermitSchema = permitSchema,
  log: (m: string) => void = console.log
): Promise<void> {
  for (const resource of schema.resources) {
    try {
      await permit.api.resources.get(resource.key)
      await permit.api.resources.update(resource.key, resourceUpdatePayload(resource))
      log(`Permit resource updated: ${resource.key}`)
    } catch {
      await permit.api.resources.create(resource)
      log(`Permit resource created: ${resource.key}`)
    }
  }

  for (const role of schema.roles) {
    try {
      await permit.api.roles.get(role.key)
      await permit.api.roles.update(role.key, {
        name: role.name,
        permissions: role.permissions,
      })
      log(`Permit role updated: ${role.key}`)
    } catch {
      await permit.api.roles.create(role)
      log(`Permit role created: ${role.key}`)
    }
  }
}

// Sync the platform base schema MERGED with the given consumer product policies.
// This is the entrypoint a product-onboarding job calls after a product submits
// its policy. Each product's resources/actions/roles are namespaced (fuzemarket.*)
// before the merge, so re-running for one product never disturbs another.
export async function syncPermitSchemaWithProducts(
  permit: PermitSchemaClient,
  products: ProductPolicy[],
  log: (m: string) => void = console.log
): Promise<void> {
  const merged = buildEnvSchema(...products)
  await syncPermitSchema(permit, merged, log)
}

/**
 * Reads every product policy REGISTERED BY A PRODUCT ITSELF
 * (PUT /api/v1/app-registry/apps/{slug}/policy → `apps.policy`).
 *
 * This is what replaces hand-listing policies in the CLI entry below. A policy that
 * wasn't in that literal list silently never reached the policy provider — invisible
 * to the product team, and indistinguishable from a policy that synced fine, because
 * a missing role just denies. Reading from the registry means registering the product
 * IS what makes its policy sync.
 *
 * Fails SOFT: the DB being unavailable must not stop the base platform schema from
 * syncing. Returns [] and logs, rather than throwing.
 */
export async function loadRegisteredProductPolicies(
  log: (m: string) => void = console.log
): Promise<ProductPolicy[]> {
  try {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { db } = require('../config/database')
    /* eslint-enable @typescript-eslint/no-var-requires */
    const rows = await db('apps')
      .whereNotNull('slug')
      .whereNotNull('policy')
      .select('slug', 'policy')

    const policies: ProductPolicy[] = []
    for (const row of rows) {
      const raw = typeof row.policy === 'string' ? JSON.parse(row.policy) : row.policy
      // The slug is authoritative — it is what the platform namespaces by, and the
      // route already rejects a body whose `product` disagrees.
      const policy: ProductPolicy = { ...raw, product: row.slug }
      try {
        validateProductPolicy(policy)
        policies.push(policy)
      } catch (err) {
        // One malformed stored policy must not block every other product's sync.
        log(
          `SKIPPING registered policy for "${row.slug}": ${(err as Error).message}`
        )
      }
    }
    log(`Loaded ${policies.length} registered product polic${policies.length === 1 ? 'y' : 'ies'}`)
    return policies
  } catch (err) {
    log(`Could not read registered product policies (${(err as Error).message}) — syncing base schema only`)
    return []
  }
}

// CLI entry — only runs when executed directly (node dist/permit/sync-permit-schema.js).
// Lazily importing the real client here keeps the module import-safe for tests.
//
// Policies come from the app registry (products register their own), PLUS the two
// legacy in-tree policies that predate self-registration. Those two stay listed until
// their products register their own policy, at which point the registry copy wins
// (mergeProductPolicy is keyed by product, and the registry entry is merged last).
if (require.main === module) {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const permit = require('../config/permit').default as PermitSchemaClient
  const legacy: ProductPolicy[] = [
    require('./products/fuzemarket.policy').default,
    require('./products/mendys-datasets.policy').default,
  ]
  /* eslint-enable @typescript-eslint/no-var-requires */
  loadRegisteredProductPolicies()
    .then(registered => {
      // A registered policy for the same product supersedes its legacy in-tree copy.
      const registeredKeys = new Set(registered.map(p => p.product))
      const kept = legacy.filter(p => !registeredKeys.has(p.product))
      return syncPermitSchemaWithProducts(permit, [...kept, ...registered])
    })
    .then(() => {
      console.log('Permit schema sync complete')
      process.exit(0)
    })
    .catch(err => {
      console.error('Permit schema sync failed:', err)
      process.exit(1)
    })
}
