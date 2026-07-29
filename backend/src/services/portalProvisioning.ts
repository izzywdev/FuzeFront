import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import type { Knex } from 'knex'
import { db as defaultDb } from '../config/database'
import { Organization } from '../types/shared'
import { createTenantInPermit } from '../utils/permit/tenant-management'
import {
  createOrganizationResourceInstance,
  setOrganizationParent,
} from '../utils/permit/resource-instances'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'
import { rowToOrganization } from './organizationProvisioning'
import { EventPublisher, defaultEventPublisher } from './eventPublisher'
import {
  generatePortalId,
  getPortalDomains,
  rowToPortal,
  PortalDto,
  PortalBranding,
  PortalIdentityPolicy,
  BillingMode,
} from '../repositories/portalRepository'

/**
 * FF-EPIC-09-S2 — resumable master-admin portal provisioning pipeline:
 * org -> Permit tenant -> Organization ReBAC instance/parent link -> portals
 * row -> default subdomain -> owner invite.
 *
 * Mirrors `services/organizationProvisioning.ts`'s reconcile pattern
 * (idempotent, dependency-ordered step log + a Postgres advisory lock) rather
 * than reinventing it — see `migrations/017_portal_provisioning.ts` for why a
 * SEPARATE table keyed by `slug` is used instead of reusing
 * `organization_provisioning` directly (that table reconciles an
 * ALREADY-EXISTING org; this pipeline creates the org itself as one of its
 * steps, so no stable id exists to key on until step 1 completes).
 *
 * CRITICAL: every step handler below NEVER throws out of the surrounding
 * `db.transaction()` callback on an infra-step failure — it catches, records
 * `failed` on the step row, and `break`s the loop. Throwing would roll back
 * the WHOLE transaction, including every step that already succeeded in this
 * same invocation, which would silently defeat AC2 (resume from the failed
 * step, never re-create prior resources): the very next attempt would have to
 * start completely over. `SlugTakenError` is the only intentional throw, and
 * it is only ever raised BEFORE any row in this transaction is touched, so
 * rolling back an empty transaction is harmless.
 */

export const PORTAL_PROVISIONING_STEPS = [
  'org_create',
  'permit_tenant_create',
  'permit_org_instance',
  'permit_org_parent',
  'portal_row_create',
  'default_domain_create',
  'owner_invite',
] as const

export type PortalProvisioningStep = (typeof PORTAL_PROVISIONING_STEPS)[number]

/** Externals injected for testing — no real Permit cloud / broker needed. */
export interface PortalProvisioningPermitClient {
  createTenant(org: Organization): Promise<void>
  createOrgInstance(org: Organization): Promise<void>
  linkParent(org: Organization, parentOrgId: string): Promise<void>
}

export interface PortalProvisioningDeps {
  db: Knex
  permit: PortalProvisioningPermitClient
  publish: EventPublisher
}

export const defaultPortalPermitClient: PortalProvisioningPermitClient = {
  async createTenant(org) {
    await createTenantInPermit(org)
  },
  async createOrgInstance(org) {
    const ok = await createOrganizationResourceInstance(org.id)
    if (!ok) throw new Error('createOrganizationResourceInstance returned false')
  },
  async linkParent(org, parentOrgId) {
    const ok = await setOrganizationParent(org.id, parentOrgId)
    if (!ok) throw new Error('setOrganizationParent returned false')
  },
}

function getDeps(overrides?: Partial<PortalProvisioningDeps>): PortalProvisioningDeps {
  return {
    db: overrides?.db ?? defaultDb,
    permit: overrides?.permit ?? defaultPortalPermitClient,
    publish: overrides?.publish ?? defaultEventPublisher,
  }
}

export interface PortalCreateInput {
  name: string
  slug: string
  ownerEmail: string
  billingMode?: BillingMode
  branding?: Partial<PortalBranding>
  identityPolicy?: Partial<PortalIdentityPolicy>
}

/** Thrown when the requested slug already belongs to a fully-provisioned (or
 * otherwise non-'provisioning') portal — a genuine duplicate. Callers map
 * this to 409 SLUG_TAKEN. */
export class SlugTakenError extends Error {
  slug: string
  constructor(slug: string) {
    super(`Portal slug '${slug}' is already taken`)
    this.name = 'SlugTakenError'
    this.slug = slug
  }
}

export interface ProvisionPortalResult {
  /** True once every infra step (org through default-domain) has completed —
   * i.e. the portal reached `provisioned-pending-invite`. The owner-invite
   * step's own outcome does NOT affect this (AC4). */
  ok: boolean
  /** The portal DTO, present whenever the portal row exists (even mid-pipeline,
   * still `provisioning`) — null only if failure occurred before the portal
   * row itself was created (steps 1-4). */
  portal: PortalDto | null
  /** True when this call resumed a PRIOR in-progress ('provisioning') attempt
   * for the same slug rather than starting fresh. */
  resumed: boolean
  failedStep?: PortalProvisioningStep
  error?: string
}

const DEFAULT_BRANDING = (name: string): PortalBranding => ({
  name,
  logo: null,
  favicon: null,
  accent: null,
  tagline: null,
})

const DEFAULT_IDENTITY_POLICY: PortalIdentityPolicy = {
  allowPasswordLogin: true,
  allowSelfSignup: false,
  mfaRequired: false,
  ssoProviders: [],
}

async function ensureStepRows(qb: Knex | Knex.Transaction, slug: string): Promise<void> {
  const rows = await qb('portal_provisioning').where({ slug })
  const present = new Set(rows.map((r: any) => r.step))
  const missing = PORTAL_PROVISIONING_STEPS.filter(s => !present.has(s)).map(step => ({
    id: uuidv4(),
    slug,
    step,
    status: 'pending',
    attempts: 0,
  }))
  if (missing.length > 0) {
    // onConflict guards a concurrent resume inserting the same rows — the
    // advisory lock already serializes this in practice, but this is cheap
    // insurance against any future caller that doesn't hold the lock.
    await qb('portal_provisioning').insert(missing).onConflict(['slug', 'step']).ignore()
  }
}

/**
 * Provisions (or resumes provisioning of) a portal for the given request key
 * (`input.slug`). See the module doc for the non-throwing step-failure
 * contract and the SlugTakenError exception to it.
 */
export async function provisionPortal(
  input: PortalCreateInput,
  actorUserId: string,
  overrides?: Partial<PortalProvisioningDeps>
): Promise<ProvisionPortalResult> {
  const deps = getDeps(overrides)
  const { db } = deps
  const slug = input.slug

  return db.transaction(async trx => {
    // AC3 — serialize concurrent same-slug requests. Held for the whole
    // pipeline; released automatically on commit/rollback.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [slug])

    const existingPortal = await trx('portals').where({ slug }).first()
    if (existingPortal && existingPortal.status !== 'provisioning') {
      // A prior attempt already reached a terminal-ish state (or this slug
      // was never in-flight to begin with) — a genuine duplicate.
      throw new SlugTakenError(slug)
    }
    // A resume is any prior in-flight attempt for this slug — NOT just "the
    // portals row already exists": a failure before step 5 (portal_row_create)
    // leaves step-log rows (e.g. org_create done, permit_org_instance failed)
    // with no `portals` row at all yet, and that is still a resume.
    const priorStepRow = await trx('portal_provisioning').where({ slug }).first()
    const resumed = !!existingPortal || !!priorStepRow

    await ensureStepRows(trx, slug)

    const stepRows: Record<PortalProvisioningStep, any> = {} as any
    for (const step of PORTAL_PROVISIONING_STEPS) {
      stepRows[step] = await trx('portal_provisioning').where({ slug, step }).first()
    }

    // Recover ids recorded by any already-`done` step (covers resuming a run
    // that failed before the portal row itself existed).
    let organizationId: string | undefined = existingPortal?.organization_id
    let portalId: string | undefined = existingPortal?.id
    for (const step of PORTAL_PROVISIONING_STEPS) {
      const row = stepRows[step]
      if (!organizationId && row?.organization_id) organizationId = row.organization_id
      if (!portalId && row?.portal_id) portalId = row.portal_id
    }

    let org: Organization | undefined
    if (organizationId) {
      const orgRow = await trx('organizations').where({ id: organizationId }).first()
      if (orgRow) org = rowToOrganization(orgRow)
    }

    async function markDone(step: PortalProvisioningStep): Promise<void> {
      const row = stepRows[step]
      await trx('portal_provisioning')
        .where({ slug, step })
        .update({
          status: 'done',
          attempts: (row?.attempts || 0) + 1,
          last_error: null,
          organization_id: organizationId ?? null,
          portal_id: portalId ?? null,
          updated_at: new Date(),
        })
    }

    async function markFailed(step: PortalProvisioningStep, error: any): Promise<void> {
      const row = stepRows[step]
      await trx('portal_provisioning')
        .where({ slug, step })
        .update({
          status: 'failed',
          attempts: (row?.attempts || 0) + 1,
          last_error: String(error?.message ?? error).slice(0, 1000),
          organization_id: organizationId ?? null,
          portal_id: portalId ?? null,
          updated_at: new Date(),
        })
    }

    const INFRA_STEPS = PORTAL_PROVISIONING_STEPS.filter(s => s !== 'owner_invite')

    let failedStep: PortalProvisioningStep | undefined
    let failureMessage: string | undefined

    for (const step of INFRA_STEPS) {
      const row = stepRows[step]
      if (row?.status === 'done') continue

      try {
        switch (step) {
          case 'org_create': {
            organizationId = uuidv4()
            await trx('organizations').insert({
              id: organizationId,
              name: input.name,
              // Namespaced so it never collides with an unrelated org's slug
              // (organizations.slug has its own independent unique index) —
              // same convention as ensurePersonalOrg's `personal-${userId}`.
              slug: `portal-${slug}`,
              parent_id: ROOT_ORG_ID,
              owner_id: actorUserId,
              type: 'organization',
              settings: JSON.stringify({}),
              metadata: JSON.stringify({ portalSlug: slug }),
              is_active: true,
              provisioning_state: 'pending',
            })
            const orgRow = await trx('organizations').where({ id: organizationId }).first()
            org = rowToOrganization(orgRow)
            break
          }
          case 'permit_tenant_create':
            await deps.permit.createTenant(org!)
            break
          case 'permit_org_instance':
            await deps.permit.createOrgInstance(org!)
            break
          case 'permit_org_parent':
            // No non-root org is ever the root itself, but guard anyway —
            // mirrors organizationProvisioning's self-link guard.
            if (org!.id !== ROOT_ORG_ID) {
              await deps.permit.linkParent(org!, ROOT_ORG_ID)
            }
            break
          case 'portal_row_create': {
            portalId = generatePortalId()
            const branding: PortalBranding = {
              ...DEFAULT_BRANDING(input.name),
              ...input.branding,
            }
            const identityPolicy: PortalIdentityPolicy = {
              ...DEFAULT_IDENTITY_POLICY,
              ...input.identityPolicy,
            }
            await trx('portals').insert({
              id: portalId,
              organization_id: organizationId,
              slug,
              name: input.name,
              status: 'provisioning',
              billing_mode: input.billingMode ?? 'free',
              branding: JSON.stringify(branding),
              identity_policy: JSON.stringify(identityPolicy),
              owner_email: input.ownerEmail,
              is_root: false,
            })
            break
          }
          case 'default_domain_create':
            await trx('portal_domains')
              .insert({
                portal_id: portalId,
                domain: `${slug}.fuzefront.com`,
                kind: 'subdomain',
                is_primary: true,
                // Auto-verified — a platform-owned subdomain, not a
                // customer-controlled DNS record (FF-EPIC-16 custom domains
                // are the ones requiring real verification).
                verification_status: 'verified',
                tls_status: 'none',
              })
              .onConflict('domain')
              .ignore()
            break
        }

        await markDone(step)
      } catch (error: any) {
        failedStep = step
        failureMessage = String(error?.message ?? error)
        await markFailed(step, error)
        // Dependency-ordered: don't attempt later steps until this one
        // succeeds on a future resumed call.
        break
      }
    }

    if (failedStep) {
      let portal: PortalDto | null = null
      if (portalId) {
        const row = await trx('portals').where({ id: portalId }).first()
        if (row) {
          const domains = await getPortalDomains(portalId, trx)
          portal = rowToPortal(row, domains)
        }
      }
      return {
        ok: false,
        portal,
        resumed,
        failedStep,
        error: `Step '${failedStep}' failed: ${failureMessage}`,
      }
    }

    // Checkpoint — every infra step is done. Flip status ->
    // provisioned-pending-invite EXACTLY ONCE (guarded by the portal still
    // being 'provisioning'), then emit portal.created. Both happen
    // regardless of the owner-invite step's own outcome below (AC4).
    const portalRowBeforeInvite = await trx('portals').where({ id: portalId }).first()
    let justTransitioned = false
    if (portalRowBeforeInvite && portalRowBeforeInvite.status === 'provisioning') {
      await trx('portals')
        .where({ id: portalId })
        .update({ status: 'provisioned-pending-invite', updated_at: new Date() })
      justTransitioned = true
    }

    // Owner invite — independently retryable; a failure here must NOT
    // regress the portal's status nor fail the overall create call (AC4).
    const inviteRow = stepRows['owner_invite']
    if (inviteRow?.status !== 'done') {
      try {
        const token = crypto.randomBytes(32).toString('hex')
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        await trx('organization_invitations')
          .insert({
            id: uuidv4(),
            organization_id: organizationId,
            email: input.ownerEmail,
            role: 'owner',
            token,
            expires_at: expiresAt,
            status: 'pending',
            invited_by: actorUserId,
          })
          .onConflict(['token'])
          .ignore()

        const correlationId = `portal-invite-${portalId}`
        await deps.publish.publishNotifyEmailRequested(
          {
            to: input.ownerEmail,
            template: 'org-invite',
            vars: { portalName: input.name, portalSlug: slug },
            orgId: organizationId,
            correlationId,
          },
          correlationId
        )

        await markDone('owner_invite')
      } catch (error: any) {
        await markFailed('owner_invite', error)
        // Swallow — never fail the create call; the portal already exists
        // at provisioned-pending-invite either way.
      }
    }

    if (justTransitioned) {
      const eventPayload = {
        portalId: portalId!,
        slug,
        organizationId: organizationId!,
        ownerEmail: input.ownerEmail,
        status: 'provisioned-pending-invite' as const,
      }
      const correlationId = `portal-created-${portalId}`
      try {
        await deps.publish.publishPortalCreated(eventPayload, correlationId)
      } catch {
        /* best-effort — the outbox row below is the durable record */
      }
      try {
        await trx('event_outbox').insert({
          id: uuidv4(),
          topic: 'portal.created',
          payload: JSON.stringify(eventPayload),
          correlation_id: correlationId,
          status: 'sent',
          attempts: 1,
          sent_at: new Date(),
        })
      } catch {
        /* outbox is advisory here, same convention as welcome_email's */
      }
    }

    const finalRow = await trx('portals').where({ id: portalId }).first()
    const domains = await getPortalDomains(portalId!, trx)
    return { ok: true, portal: rowToPortal(finalRow, domains), resumed }
  })
}
