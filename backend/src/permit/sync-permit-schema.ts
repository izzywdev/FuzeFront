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
    // ReBAC relations are optional on the client: a control plane / SDK without
    // relation support simply skips them (the schema's `relations` are also
    // optional). When present, relations are created idempotently per subject
    // resource. `list` lets us skip a relation that already exists.
    resourceRelations?: {
      list(subjectResource: string): Promise<unknown>
      create(subjectResource: string, def: unknown): Promise<unknown>
    }
  }
}

// Best-effort extraction of relation keys already defined on a resource, across
// the few shapes the permitio list endpoint returns (array | {data:[]} | {relations:[]}).
function existingRelationKeys(listed: unknown): Set<string> {
  const arr = Array.isArray(listed)
    ? listed
    : Array.isArray((listed as any)?.data)
      ? (listed as any).data
      : Array.isArray((listed as any)?.relations)
        ? (listed as any).relations
        : []
  return new Set(arr.map((r: any) => r?.key).filter(Boolean))
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

  // ReBAC relations (e.g. Agent delegate_of User). Optional: skipped entirely if
  // the schema declares none or the client surface lacks relation support.
  // Idempotent create-if-absent — relations have no "update" worth applying here.
  const relations = schema.relations ?? []
  const relationsApi = permit.api.resourceRelations
  if (relations.length > 0 && relationsApi) {
    for (const relation of relations) {
      let existing: Set<string>
      try {
        existing = existingRelationKeys(
          await relationsApi.list(relation.subject_resource)
        )
      } catch {
        existing = new Set()
      }
      if (existing.has(relation.key)) {
        log(`Permit relation exists: ${relation.subject_resource}.${relation.key}`)
        continue
      }
      await relationsApi.create(relation.subject_resource, {
        key: relation.key,
        name: relation.name,
        subject_resource: relation.subject_resource,
        object_resource: relation.object_resource,
      })
      log(`Permit relation created: ${relation.subject_resource}.${relation.key} -> ${relation.object_resource}`)
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
