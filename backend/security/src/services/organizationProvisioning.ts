import { v4 as uuidv4 } from 'uuid'
import { mintId, toUuid } from '@izzywdev/fuzefront-identity'
import { db as defaultDb } from '../config/database'
import { Organization } from '../types/shared'
import { createTenantInPermit } from '../utils/permit/tenant-management'
import { syncUserToPermit } from '../utils/permit/user-sync'
import { assignOrganizationRole } from '../utils/permit/role-assignment'
import {
  EventPublisher,
  defaultEventPublisher,
} from './eventPublisher'
import { ROOT_ORG_ID } from '../migrations/014_seed_root_platform_organization'
import { isRootMembershipEnabled } from '../utils/rootMembershipFlag'
import type { Knex } from 'knex'
import { logger } from '../lib/logger'

/**
 * Plan B — tenant provisioning that is correct, idempotent, and self-healing.
 *
 * The DB table `organization_provisioning` is the source of truth for each org's
 * Permit wiring. The reconciler runs missing/failed steps in dependency order,
 * skips `done` steps, records failures, and flips the org to `active` once every
 * step is done. It is safe to call repeatedly (org-create, login, internal HTTP).
 */

export const PROVISIONING_STEPS = [
  'permit_user_sync',
  'permit_tenant_create',
  'permit_role_assign',
  'welcome_email',
] as const

export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number]

/** Externals injected for testing (no real Permit cloud / broker needed). */
export interface ProvisioningPermitClient {
  syncUser(org: Organization, ownerEmail: string): Promise<void>
  createTenant(org: Organization): Promise<void>
  assignOwnerRole(org: Organization): Promise<void>
}

export interface ProvisioningDeps {
  db: Knex
  permit: ProvisioningPermitClient
  publish: EventPublisher
}

/**
 * Default Permit client built on the existing utils. Each call throws on a real
 * failure (so the step records `failed`) and resolves on success / benign 409.
 */
export const defaultPermitClient: ProvisioningPermitClient = {
  async syncUser(org, ownerEmail) {
    const ok = await syncUserToPermit({
      id: org.owner_id,
      email: ownerEmail,
      roles: [],
    } as any)
    if (!ok) throw new Error('syncUserToPermit returned false')
  },
  async createTenant(org) {
    // createTenantInPermit throws on real failure, returns true on success/409.
    await createTenantInPermit(org)
  },
  async assignOwnerRole(org) {
    const ok = await assignOrganizationRole(org.owner_id, org.id, 'owner')
    if (!ok) throw new Error('assignOrganizationRole returned false')
  },
}

function getDeps(overrides?: Partial<ProvisioningDeps>): ProvisioningDeps {
  return {
    db: overrides?.db ?? defaultDb,
    permit: overrides?.permit ?? defaultPermitClient,
    publish: overrides?.publish ?? defaultEventPublisher,
  }
}

function rowToOrganization(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parent_id: row.parent_id,
    owner_id: row.owner_id,
    type: row.type,
    settings:
      typeof row.settings === 'string'
        ? JSON.parse(row.settings || '{}')
        : row.settings || {},
    metadata:
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata || '{}')
        : row.metadata || {},
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * Idempotently ensure the user has exactly ONE personal org (type='personal')
 * with an owner membership. Returns the personal org. Re-running is a no-op.
 */
export async function ensurePersonalOrg(
  userId: string,
  overrides?: Partial<ProvisioningDeps>
): Promise<Organization> {
  const { db } = getDeps(overrides)

  const existing = await db('organizations')
    .where({ owner_id: userId, type: 'personal' })
    .first()
  if (existing) {
    logger.debug({ userId, orgId: existing.id }, 'organizationProvisioning: personal org already exists')
    return rowToOrganization(existing)
  }
  logger.info({ userId }, 'organizationProvisioning: creating personal org')

  const user = await db('users').where({ id: userId }).first()
  if (!user) throw new Error(`Cannot create personal org: user ${userId} not found`)

  const orgId = toUuid(mintId('organization'))
  // Use the full userId so the slug is globally unique per user (M1 — a
  // truncated 8-char prefix shares only 32 bits of entropy and two different
  // users can produce the same slug, silently losing the loser's personal org).
  const baseSlug = `personal-${userId}`

  try {
    await db.transaction(async trx => {
      // ON CONFLICT DO NOTHING on the partial unique index keeps concurrent
      // races from surfacing a 23505 error. The SELECT below then retrieves
      // whichever caller actually created the row.
      await trx('organizations')
        .insert({
          id: orgId,
          name: 'Personal',
          slug: baseSlug,
          parent_id: null,
          owner_id: userId,
          type: 'personal',
          settings: JSON.stringify({}),
          metadata: JSON.stringify({ personal: true }),
          is_active: true,
          provisioning_state: 'pending',
        })
        .onConflict(trx.raw("(owner_id) WHERE type = 'personal'"))
        .ignore()

      const actualOrg = await trx('organizations')
        .where({ owner_id: userId, type: 'personal' })
        .first()

      if (!actualOrg) {
        throw new Error(`Personal org still missing for user ${userId} after insert attempt`)
      }

      await trx('organization_memberships')
        .insert({
          id: toUuid(mintId('membership')),
          user_id: userId,
          organization_id: actualOrg.id,
          role: 'owner',
          status: 'active',
          joined_at: new Date(),
          permissions: JSON.stringify({}),
          metadata: JSON.stringify({}),
        })
        .onConflict(['user_id', 'organization_id'])
        .ignore()
    })
  } catch (error: any) {
    // The `slug` unique constraint (`organizations_slug_unique`) is a
    // DIFFERENT index than the `onConflict` arbiter above (the partial
    // `uq_personal_org_per_owner` index, which only fires when the existing
    // row's type is already 'personal'). Postgres only suppresses a conflict
    // that matches the arbiter you named, so a 23505 on `slug` still throws
    // out of the transaction above and lands here.
    //
    // Because `baseSlug` is fully deterministic (`personal-${userId}`), a
    // slug collision here can only be THIS user's own row, already present
    // under a DIFFERENT `type` — exactly the 2026-08-23 personal-org
    // over-reclassification incident (migration 015's unconditional
    // reclassify step; see `017_repair_personal_org_over_reclassification.ts`).
    // Self-heal it here too, at login time, rather than surfacing a raw
    // constraint violation and leaving the user's workspace looking "gone":
    // flip that row back to `type='personal'` and ensure its owner
    // membership exists, instead of blindly re-selecting by
    // `type='personal'` (which would keep missing) and rethrowing.
    if (error?.code === '23505' && String(error?.constraint) === 'organizations_slug_unique') {
      const bySlug = await db('organizations').where({ slug: baseSlug }).first()
      if (bySlug && bySlug.owner_id === userId) {
        if (bySlug.type !== 'personal') {
          logger.warn(
            { userId, orgId: bySlug.id, previousType: bySlug.type },
            'organizationProvisioning: self-healing mis-typed personal org'
          )
          await db('organizations')
            .where({ id: bySlug.id })
            .update({ type: 'personal', updated_at: db.fn.now() })
        }
        await db('organization_memberships')
          .insert({
            id: toUuid(mintId('membership')),
            user_id: userId,
            organization_id: bySlug.id,
            role: 'owner',
            status: 'active',
            joined_at: new Date(),
            permissions: JSON.stringify({}),
            metadata: JSON.stringify({}),
          })
          .onConflict(['user_id', 'organization_id'])
          .ignore()
        const healed = await db('organizations').where({ id: bySlug.id }).first()
        return rowToOrganization(healed)
      }
      // A slug collision NOT owned by this user should be unreachable (the
      // slug is derived from userId), but never silently adopt someone
      // else's organization — surface a clear diagnostic instead of the raw
      // pg error.
      logger.error(
        { userId, baseSlug, conflictingOwnerId: bySlug?.owner_id },
        'organizationProvisioning: slug collision owned by a different user — refusing to proceed'
      )
      throw new Error(
        `ensurePersonalOrg: slug '${baseSlug}' already used by a different owner ` +
          `(${bySlug?.owner_id ?? 'unknown'}) — refusing to proceed`
      )
    }

    // Concurrent create lost the race (owner_id partial index) — return
    // whatever personal org now exists.
    const raced = await db('organizations')
      .where({ owner_id: userId, type: 'personal' })
      .first()
    if (raced) {
      logger.info({ userId, orgId: raced.id }, 'organizationProvisioning: personal org create raced — using winner')
      return rowToOrganization(raced)
    }
    logger.error({ userId, err: error?.message }, 'organizationProvisioning: personal org create failed')
    throw error
  }

  logger.info({ userId, orgId }, 'organizationProvisioning: personal org created')
  // Re-select by (owner_id, type) rather than the minted `orgId` — with
  // ON CONFLICT ... DO NOTHING above, a concurrent creator may have won the
  // race and `orgId` may not be the row that actually exists.
  const created = await db('organizations')
    .where({ owner_id: userId, type: 'personal' })
    .first()
  return rowToOrganization(created)
}

async function ensureStepRows(db: Knex, orgId: string): Promise<void> {
  await ensureStepRowsTrx(db, orgId)
}

// Accepts either a Knex instance or a transaction (both expose the same query API).
async function ensureStepRowsTrx(
  qb: Knex | Knex.Transaction,
  orgId: string
): Promise<void> {
  const rows = await qb('organization_provisioning').where({
    organization_id: orgId,
  })
  const present = new Set(rows.map((r: any) => r.step))
  const missing = PROVISIONING_STEPS.filter(s => !present.has(s)).map(step => ({
    id: uuidv4(),
    organization_id: orgId,
    step,
    status: 'pending',
    attempts: 0,
  }))
  if (missing.length > 0) {
    // onConflict guards against a concurrent reconcile inserting the same rows.
    await qb('organization_provisioning')
      .insert(missing)
      .onConflict(['organization_id', 'step'])
      .ignore()
  }
}

async function runStep(
  deps: ProvisioningDeps,
  org: Organization,
  ownerEmail: string,
  step: ProvisioningStep
): Promise<void> {
  switch (step) {
    case 'permit_user_sync':
      await deps.permit.syncUser(org, ownerEmail)
      break
    case 'permit_tenant_create':
      await deps.permit.createTenant(org)
      break
    case 'permit_role_assign':
      await deps.permit.assignOwnerRole(org)
      break
    case 'welcome_email': {
      const correlationId = `welcome-${org.id}`
      await deps.publish.publishNotifyEmailRequested(
        {
          to: ownerEmail,
          template: 'welcome',
          vars: { orgName: org.name },
          orgId: org.id,
          correlationId,
        },
        correlationId
      )
      // Best-effort durable record (table may not exist in older test DBs).
      try {
        await deps.db('event_outbox').insert({
          id: uuidv4(),
          topic: 'notify.email.requested',
          payload: JSON.stringify({ to: ownerEmail, template: 'welcome', orgId: org.id }),
          correlation_id: correlationId,
          status: 'sent',
          attempts: 1,
          sent_at: new Date(),
        })
      } catch {
        /* outbox is advisory here */
      }
      break
    }
  }
}

/**
 * Idempotent, dependency-ordered reconciliation of an org's Permit provisioning.
 * Skips `done` steps; retries `pending`/`failed`; records `last_error` and bumps
 * `attempts` on failure; flips org to `active` when all steps are done.
 * Returns the org's final provisioning_state.
 */
export async function reconcileOrganizationProvisioning(
  orgId: string,
  overrides?: Partial<ProvisioningDeps>
): Promise<'active' | 'pending' | 'failed'> {
  const deps = getDeps(overrides)
  const { db } = deps
  const reconcileStart = Date.now()
  logger.info({ orgId }, 'organizationProvisioning: reconcile start')

  // I2 — serialize concurrent reconciles of the same org with a Postgres
  // advisory transaction lock so two concurrent callers never both execute the
  // `welcome_email` step (or any step) simultaneously.  The lock is held for
  // the duration of the transaction and released automatically on commit/rollback.
  return db.transaction(async trx => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [orgId])

    const orgRow = await trx('organizations').where({ id: orgId }).first()
    if (!orgRow) throw new Error(`reconcile: organization ${orgId} not found`)
    const org = rowToOrganization(orgRow)

    const owner = await trx('users').where({ id: org.owner_id }).first()
    const ownerEmail: string = owner?.email || `${org.owner_id}@unknown.local`

    // ensureStepRows must use the same transaction so its upsert is within the lock.
    await ensureStepRowsTrx(trx, orgId)

    let anyFailed = false

    for (const step of PROVISIONING_STEPS) {
      const row = await trx('organization_provisioning')
        .where({ organization_id: orgId, step })
        .first()
      if (row?.status === 'done') continue

      try {
        await runStep({ ...deps, db: trx as unknown as typeof db }, org, ownerEmail, step)
        await trx('organization_provisioning')
          .where({ organization_id: orgId, step })
          .update({
            status: 'done',
            attempts: (row?.attempts || 0) + 1,
            last_error: null,
            updated_at: new Date(),
          })
        logger.debug({ orgId, step }, 'organizationProvisioning: step done')
      } catch (error: any) {
        anyFailed = true
        logger.error(
          { orgId, step, attempts: (row?.attempts || 0) + 1, err: String(error?.message ?? error) },
          'organizationProvisioning: step failed'
        )
        await trx('organization_provisioning')
          .where({ organization_id: orgId, step })
          .update({
            status: 'failed',
            attempts: (row?.attempts || 0) + 1,
            last_error: String(error?.message ?? error).slice(0, 1000),
            updated_at: new Date(),
          })
        // Dependency-ordered: don't run later steps until this one succeeds.
        break
      }
    }

    const steps = await trx('organization_provisioning').where({
      organization_id: orgId,
    })
    const allDone =
      steps.length === PROVISIONING_STEPS.length &&
      steps.every((s: any) => s.status === 'done')

    const newState: 'active' | 'pending' | 'failed' = allDone
      ? 'active'
      : anyFailed
        ? 'failed'
        : 'pending'

    await trx('organizations')
      .where({ id: orgId })
      .update({ provisioning_state: newState, updated_at: new Date() })

    logger.info(
      { orgId, newState, elapsedMs: Date.now() - reconcileStart },
      'organizationProvisioning: reconcile end'
    )
    return newState
  })
}

/**
 * Idempotently upserts the user's membership in the root platform org (type=root).
 * A dedicated root-org membership lets platform APIs enumerate all users without
 * yielding exactly one row. Used by `runInternalProvision` when the
 * `fuzefront.identity.root-membership` flag is ON.
 */
export async function ensureRootMembership(
  userId: string,
  deps: { db: Knex }
): Promise<void> {
  // Same discipline as migrations 014/015: never insert a reference to a row
  // you have not verified exists. `ROOT_ORG_ID` is a constant, not a lookup,
  // and migration 014 has paths that legitimately leave the row absent — in
  // which case this insert raises 23503 and fails provisioning for the user.
  // Skipping is equivalent to the feature flag being OFF, which is strictly
  // better than a failed signup, but it must be loud: it means the root org
  // is missing, not that this user needed no membership.
  const rootOrg = await deps.db('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!rootOrg) {
    logger.error(
      { userId, rootOrgId: ROOT_ORG_ID },
      'ensureRootMembership: root organization does not exist — skipping (see migration 014)'
    )
    return
  }

  await deps.db('organization_memberships')
    .insert({
      id: toUuid(mintId('membership')),
      user_id: userId,
      organization_id: ROOT_ORG_ID,
      role: 'member',
      status: 'active',
      joined_at: new Date(),
      permissions: JSON.stringify({}),
      metadata: JSON.stringify({}),
    })
    .onConflict(['user_id', 'organization_id'])
    .ignore()
}

/**
 * Deprovision an organization.
 *
 * - soft: marks is_active=false (reversible; data retained).
 * - hard: deletes memberships, provisioning steps, and the org row (irreversible).
 *
 * Idempotent: if the org is already gone, returns deprovisioned=true without error.
 */
export async function deprovisionOrganization(
  orgId: string,
  mode: 'soft' | 'hard',
  overrides?: Partial<ProvisioningDeps>
): Promise<{ organizationId: string; mode: string; deprovisioned: boolean }> {
  const { db } = getDeps(overrides)

  const org = await db('organizations').where({ id: orgId }).first()
  if (!org) {
    logger.info({ orgId, mode }, 'organizationProvisioning: deprovision — org not found, already gone')
    return { organizationId: orgId, mode, deprovisioned: true }
  }

  if (mode === 'hard') {
    await db.transaction(async trx => {
      await trx('organization_memberships').where({ organization_id: orgId }).delete()
      await trx('organization_provisioning').where({ organization_id: orgId }).delete()
      await trx('organizations').where({ id: orgId }).delete()
    })
  } else {
    await db('organizations')
      .where({ id: orgId })
      .update({ is_active: false, provisioning_state: 'deprovisioned', updated_at: new Date() })
  }

  logger.info({ orgId, mode }, 'organizationProvisioning: deprovisioned')
  return { organizationId: orgId, mode, deprovisioned: true }
}

/**
 * Single-sourced entry point used by login self-heal AND the internal HTTP
 * endpoint (Plan D's provisioning-service). Ensures the user's personal org
 * exists, then reconciles every org they own that isn't yet active.
 */
export async function runInternalProvision(
  userId: string,
  overrides?: Partial<ProvisioningDeps>
): Promise<{
  personalOrgId: string | null
  reconciled: Array<{ orgId: string; state: string }>
}> {
  const { db } = getDeps(overrides)

  const rootMembership = await isRootMembershipEnabled({ userId })
  if (rootMembership) {
    await ensureRootMembership(userId, { db })
    return { personalOrgId: null, reconciled: [] }
  }

  const personal = await ensurePersonalOrg(userId, overrides)

  const ownedOrgs = await db('organizations')
    .where({ owner_id: userId })
    .whereNot({ provisioning_state: 'active' })

  const reconciled: Array<{ orgId: string; state: string }> = []
  for (const org of ownedOrgs) {
    const state = await reconcileOrganizationProvisioning(org.id, overrides)
    reconciled.push({ orgId: org.id, state })
  }

  return { personalOrgId: personal.id, reconciled }
}
