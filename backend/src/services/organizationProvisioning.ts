import { v4 as uuidv4 } from 'uuid'
import { db as defaultDb } from '../config/database'
import { Organization } from '../types/shared'
import { createTenantInPermit } from '../utils/permit/tenant-management'
import { syncUserToPermit } from '../utils/permit/user-sync'
import { assignOrganizationRole } from '../utils/permit/role-assignment'
import {
  EventPublisher,
  defaultEventPublisher,
} from './eventPublisher'
import type { Knex } from 'knex'

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
  if (existing) return rowToOrganization(existing)

  const user = await db('users').where({ id: userId }).first()
  if (!user) throw new Error(`Cannot create personal org: user ${userId} not found`)

  const orgId = uuidv4()
  // Use the full userId so the slug is globally unique per user (M1 — a
  // truncated 8-char prefix shares only 32 bits of entropy and two different
  // users can produce the same slug, silently losing the loser's personal org).
  const baseSlug = `personal-${userId}`

  try {
    await db.transaction(async trx => {
      // ON CONFLICT DO NOTHING on the partial unique index keeps concurrent
      // races from surfacing a 23505 error to Postgres logs.  The SELECT below
      // then retrieves whichever caller actually created the row.
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

      // Re-select the authoritative row: if the INSERT was a no-op (race lost),
      // actualOrg.id differs from orgId; the membership must use the real id.
      const actualOrg = await trx('organizations')
        .where({ owner_id: userId, type: 'personal' })
        .first()

      if (!actualOrg) {
        throw new Error(`Personal org still missing for user ${userId} after insert attempt`)
      }

      // Upsert the owner membership so re-runs of ensurePersonalOrg are safe even
      // when the org already exists with its membership (unique index on
      // organization_memberships(user_id, organization_id)).
      await trx('organization_memberships')
        .insert({
          id: uuidv4(),
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
    // Safety net for any remaining error (e.g. slug conflict from a concurrent
    // create that hits a different index than the owner_id partial index).
    const raced = await db('organizations')
      .where({ owner_id: userId, type: 'personal' })
      .first()
    if (raced) return rowToOrganization(raced)
    throw error
  }

  // Return the personal org — either the one we created or the one that won the race.
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
      } catch (error: any) {
        anyFailed = true
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

    return newState
  })
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
  personalOrgId: string
  reconciled: Array<{ orgId: string; state: string }>
}> {
  const { db } = getDeps(overrides)
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
