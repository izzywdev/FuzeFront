import { permitSchema, PermitSchema, PermitResourceDef } from './schema'
import { ProductPolicy, buildEnvSchema } from './product-policy'

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

// CLI entry — only runs when executed directly (node dist/permit/sync-permit-schema.js).
// Lazily importing the real client here keeps the module import-safe for tests.
// Product policies (backend/src/permit/products/*) must be listed here — the
// permit-schema-sync Job runs this entry, and a policy that isn't passed to
// syncPermitSchemaWithProducts never reaches the Permit control plane.
if (require.main === module) {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const permit = require('../config/permit').default as PermitSchemaClient
  const products: ProductPolicy[] = [
    require('./products/fuzemarket.policy').default,
    require('./products/mendys-datasets.policy').default,
  ]
  /* eslint-enable @typescript-eslint/no-var-requires */
  syncPermitSchemaWithProducts(permit, products)
    .then(() => {
      console.log('Permit schema sync complete')
      process.exit(0)
    })
    .catch(err => {
      console.error('Permit schema sync failed:', err)
      process.exit(1)
    })
}
