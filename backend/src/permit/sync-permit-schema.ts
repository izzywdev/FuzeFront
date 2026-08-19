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

// ── Observability ─────────────────────────────────────────────────────────────
//
// EVERY failure mode on this path is fail-soft by design, and that design is
// correct: Permit being unreachable must not stop the platform booting, one
// malformed stored policy must not block every other product, and authorization
// already fails closed. But fail-soft with no signal is how this breaks in a way
// nobody can diagnose — the symptom of "the sync silently dropped your product"
// is "your users have no permissions", which is indistinguishable from a bug in
// the PRODUCT. The product team has no access to the platform pod log, and there
// is nothing else to look at.
//
// So the sync now RECORDS what it did. `getPermitSyncStatus()` is surfaced on
// /health, which makes "did my policy actually reach Permit?" a question a
// product team can answer for itself with one curl, and makes a silent drop
// visible to monitoring instead of only to whoever happens to read stdout.

export type PermitSyncOutcome =
  | 'never_run'
  /** Base schema + every product policy the registry had, pushed to Permit. */
  | 'ok'
  /**
   * The base schema synced, but the app registry could not be read — so NO
   * registered product policy was included. Products appear to have no roles.
   */
  | 'registry_unavailable'
  /** The push to Permit itself threw. The environment schema may be stale. */
  | 'sync_failed'

export interface PermitSyncStatus {
  outcome: PermitSyncOutcome
  /** ISO timestamp of the last attempt, or null if it has never run. */
  at: string | null
  /** Slugs whose REGISTERED policy was included in the synced schema. */
  registeredProducts: string[]
  /**
   * Slugs whose stored policy was rejected by validation and therefore silently
   * omitted. A non-empty list here is the single highest-value diagnostic on
   * this endpoint: those products are live with no roles.
   */
  rejectedProducts: { slug: string; reason: string }[]
  /** Legacy in-tree policies dropped because the product registered its own. */
  supersededLegacy: string[]
  /** Legacy in-tree policies still in force (the product has not registered one). */
  legacyProducts: string[]
  resources: number
  roles: number
  error: string | null
}

let lastSyncStatus: PermitSyncStatus = {
  outcome: 'never_run',
  at: null,
  registeredProducts: [],
  rejectedProducts: [],
  supersededLegacy: [],
  legacyProducts: [],
  resources: 0,
  roles: 0,
  error: null,
}

/** The result of the most recent sync attempt in this process. */
export function getPermitSyncStatus(): PermitSyncStatus {
  return {
    ...lastSyncStatus,
    rejectedProducts: lastSyncStatus.rejectedProducts.map(r => ({ ...r })),
  }
}

/** Test-only: reset the recorded status between cases. */
export function resetPermitSyncStatus(): void {
  lastSyncStatus = {
    outcome: 'never_run',
    at: null,
    registeredProducts: [],
    rejectedProducts: [],
    supersededLegacy: [],
    legacyProducts: [],
    resources: 0,
    roles: 0,
    error: null,
  }
}

/**
 * Sync the environment schema MERGED WITH every product policy — the base
 * schema plus legacy in-tree policies plus registry-registered ones.
 *
 * Extracted so the boot path and the CLI entry below share one definition.
 * Syncing the base schema ALONE would omit product policies, and a role that
 * isn't in the synced schema just denies — silently.
 *
 * Records the outcome in `getPermitSyncStatus()` and RE-THROWS on failure, so
 * the caller decides the policy: the boot path logs and carries on (the platform
 * must start), the CLI job exits non-zero (a Job that did not do its job must
 * not report success).
 */
export async function syncPermitSchemaFromRegistry(
  permit: PermitSchemaClient,
  legacy: ProductPolicy[],
  log: (m: string) => void = console.log
): Promise<PermitSyncStatus> {
  const load = await loadRegisteredPolicyResult(log)
  // A registered policy for the same product supersedes its legacy in-tree copy.
  // Without this the merge would hit a namespaced-key collision and throw, which
  // (being fail-soft upstream) would drop the ENTIRE schema sync — base included.
  const registeredKeys = new Set(load.policies.map(p => p.product))
  const kept = legacy.filter(p => !registeredKeys.has(p.product))
  const superseded = legacy.filter(p => registeredKeys.has(p.product)).map(p => p.product)

  const status: PermitSyncStatus = {
    outcome: load.available ? 'ok' : 'registry_unavailable',
    at: new Date().toISOString(),
    registeredProducts: load.policies.map(p => p.product),
    rejectedProducts: load.rejected,
    supersededLegacy: superseded,
    legacyProducts: kept.map(p => p.product),
    resources: 0,
    roles: 0,
    error: load.available ? null : load.error,
  }

  try {
    const merged = buildEnvSchema(...kept, ...load.policies)
    status.resources = merged.resources.length
    status.roles = merged.roles.length
    await syncPermitSchema(permit, merged, log)
  } catch (err) {
    status.outcome = 'sync_failed'
    status.error = (err as Error).message
    lastSyncStatus = status
    throw err
  }

  lastSyncStatus = status
  if (status.rejectedProducts.length > 0) {
    log(
      `⚠️  Permit sync REJECTED ${status.rejectedProducts.length} stored polic(y|ies) — ` +
        `${status.rejectedProducts.map(r => r.slug).join(', ')} have NO product roles in Permit`
    )
  }
  if (!load.available) {
    log(
      '⚠️  Permit sync ran WITHOUT the app registry — every self-registered product ' +
        'policy was omitted and those products have no roles in Permit'
    )
  }
  return status
}

export interface RegisteredPolicyLoad {
  /**
   * FALSE means the registry could not be read at all. Critically different from
   * `policies: []` with `available: true` (nobody has registered a policy yet) —
   * the two produce an identical synced schema but mean opposite things, and
   * collapsing them is exactly how a total registry outage passes for "no
   * products registered".
   */
  available: boolean
  policies: ProductPolicy[]
  /** Stored policies that failed validation and were therefore NOT synced. */
  rejected: { slug: string; reason: string }[]
  error: string | null
}

/**
 * Reads every product policy REGISTERED BY A PRODUCT ITSELF
 * (PUT /api/v1/app-registry/apps/{slug}/policy → `apps.policy`), reporting what it
 * could and could not read rather than flattening both to a list.
 *
 * Fails SOFT: the DB being unavailable must not stop the base platform schema from
 * syncing. But it is recorded, surfaced on /health, and made fatal in the CLI job.
 */
export async function loadRegisteredPolicyResult(
  log: (m: string) => void = console.log
): Promise<RegisteredPolicyLoad> {
  const rejected: { slug: string; reason: string }[] = []
  try {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { db } = require('../config/database')
    /* eslint-enable @typescript-eslint/no-var-requires */

    // The `apps.slug` and `apps.policy` columns are provisioned by the
    // APPLICATIONS-service migration chain (006_add_app_policy_and_billing,
    // recorded under knex_migrations_apps) — NOT by this (backend) image, whose
    // chain only creates the base `apps` table (002_create_apps_table). On a
    // fresh install or a coordinated upgrade the permit-schema-sync post-upgrade
    // hook can run before the applications service has landed that migration.
    //
    // When the column is genuinely absent, NO product has been able to register
    // a policy yet, so the correct result is "registry available, zero
    // registered policies" (available: true) — NOT "registry unavailable". The
    // distinction matters because the CLI job treats `available: false` as fatal
    // (exit 1): letting the SELECT throw `column "policy" does not exist` here
    // turned a benign deploy-ordering window into a crash-looping Job.
    //
    // The hard-fail stays reserved for a REAL registry outage: if the DB is
    // unreachable, `hasTable`/`hasColumn` themselves reject and land in the
    // catch below → available: false → the job exits non-zero, exactly as
    // designed. We only downgrade to "empty" when we can POSITIVELY confirm the
    // storage does not exist, never when we simply failed to read it.
    const hasApps = await db.schema.hasTable('apps')
    const hasPolicyStorage =
      hasApps &&
      (await db.schema.hasColumn('apps', 'slug')) &&
      (await db.schema.hasColumn('apps', 'policy'))
    if (!hasPolicyStorage) {
      log(
        'App-registry policy storage not present yet (apps.policy column ' +
          'unmigrated) — no product has registered a policy; syncing the base + ' +
          'legacy schema only'
      )
      return { available: true, policies: [], rejected, error: null }
    }

    const rows = await db('apps')
      .whereNotNull('slug')
      .whereNotNull('policy')
      .select('slug', 'policy')

    const policies: ProductPolicy[] = []
    for (const row of rows) {
      let policy: ProductPolicy
      try {
        const raw = typeof row.policy === 'string' ? JSON.parse(row.policy) : row.policy
        // The slug is authoritative — it is what the platform namespaces by, and the
        // route already rejects a body whose `product` disagrees.
        policy = { ...raw, product: row.slug }
        validateProductPolicy(policy)
      } catch (err) {
        // One malformed stored policy must not block every other product's sync —
        // but it is no longer a log line and nothing else. It is reported.
        const reason = (err as Error).message
        rejected.push({ slug: row.slug, reason })
        log(`SKIPPING registered policy for "${row.slug}": ${reason}`)
        continue
      }
      policies.push(policy)
    }
    log(`Loaded ${policies.length} registered product polic${policies.length === 1 ? 'y' : 'ies'}`)
    return { available: true, policies, rejected, error: null }
  } catch (err) {
    const message = (err as Error).message
    log(`Could not read registered product policies (${message}) — syncing base schema only`)
    return { available: false, policies: [], rejected, error: message }
  }
}

/**
 * Back-compat list form of {@link loadRegisteredPolicyResult}. Prefer the result
 * form — this one cannot tell "no policies registered" from "registry unreadable".
 */
export async function loadRegisteredProductPolicies(
  log: (m: string) => void = console.log
): Promise<ProductPolicy[]> {
  return (await loadRegisteredPolicyResult(log)).policies
}

/** The legacy in-tree product policies that predate product self-registration. */
export function loadLegacyProductPolicies(): ProductPolicy[] {
  /* eslint-disable @typescript-eslint/no-var-requires */
  return [
    require('./products/fuzemarket.policy').default,
    require('./products/mendys-datasets.policy').default,
    require('./products/fuzefinance.policy').default,
  ]
  /* eslint-enable @typescript-eslint/no-var-requires */
}

// CLI entry — only runs when executed directly (node dist/permit/sync-permit-schema.js).
// Lazily importing the real client here keeps the module import-safe for tests.
//
// Policies come from the app registry (products register their own), PLUS the legacy
// in-tree policies that predate self-registration. A legacy policy stays in force
// until its product registers its own, at which point the registry copy supersedes it.
//
// UNLIKE the boot path, this exits NON-ZERO when the registry could not be read. The
// boot path is soft because the platform must start; a Job exists only to do this one
// thing, and a Job that pushed the base schema while silently dropping every product
// policy has failed. Reporting success there is what turns a broken deploy into a
// mystery ticket from a product team a week later.
if (require.main === module) {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const permit = require('../config/permit').default as PermitSchemaClient
  /* eslint-enable @typescript-eslint/no-var-requires */
  syncPermitSchemaFromRegistry(permit, loadLegacyProductPolicies())
    .then(status => {
      console.log(
        `Permit schema sync complete — ${status.resources} resources, ${status.roles} roles, ` +
          `${status.registeredProducts.length} registered product(s)` +
          (status.supersededLegacy.length
            ? `, superseded legacy: ${status.supersededLegacy.join(', ')}`
            : '')
      )
      if (status.outcome !== 'ok') {
        console.error(
          `Permit schema sync did NOT include registered product policies ` +
            `(${status.outcome}: ${status.error}) — failing so this deploy is not ` +
            `mistaken for a good one. Check the job has DB_HOST/DB_NAME/DB_USER/` +
            `DB_PASSWORD and USE_POSTGRES=true.`
        )
        process.exit(1)
      }
      if (status.rejectedProducts.length > 0) {
        for (const r of status.rejectedProducts) {
          console.error(`Rejected stored policy for "${r.slug}": ${r.reason}`)
        }
        process.exit(1)
      }
      process.exit(0)
    })
    .catch(err => {
      console.error('Permit schema sync failed:', err)
      process.exit(1)
    })
}
