import { permitSchema, PermitSchema } from './schema'

export { permitSchema } from './schema'
export type { PermitSchema, PermitResourceDef, PermitRoleDef } from './schema'

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

// get-or-(create|update): idempotent and agnostic to SDK error shapes.
export async function syncPermitSchema(
  permit: PermitSchemaClient,
  schema: PermitSchema = permitSchema,
  log: (m: string) => void = console.log
): Promise<void> {
  for (const resource of schema.resources) {
    try {
      await permit.api.resources.get(resource.key)
      await permit.api.resources.update(resource.key, {
        name: resource.name,
        actions: resource.actions,
      })
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

// CLI entry — only runs when executed directly (node dist/permit/sync-permit-schema.js).
// Lazily importing the real client here keeps the module import-safe for tests.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const permit = require('../config/permit').default as PermitSchemaClient
  syncPermitSchema(permit)
    .then(() => {
      console.log('Permit schema sync complete')
      process.exit(0)
    })
    .catch(err => {
      console.error('Permit schema sync failed:', err)
      process.exit(1)
    })
}
