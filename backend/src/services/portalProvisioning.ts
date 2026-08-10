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
import { isMultiTenantPortalsEnabled } from '../utils/portalFlag'
import { createAuthentikRedirectRegistrar } from '../custom-domains/authentikRedirect'
import type { RedirectUriRegistrar } from '../custom-domains/customHostnameService'
import { createAuthentikBrandRegistrar } from '../authentik/portalBrand'
import type { PortalBrandRegistrar } from '../authentik/portalBrand'

/**
 * FF-EPIC-09-S2 — resumable master-admin portal provisioning pipeline:
 * org -> Permit tenant -> Organization ReBAC instance/parent link -> portals
 * row -> default subdomain -> Authentik redirect URI -> Authentik brand ->
 * owner invite.
 *
 * Mirrors `services/organizationProvisioning.ts`'s reconcile pattern
 * (idempotent, dependency-ordered step log + a Postgres advisory lock) rather
 * than reinventing it — see `migrations/018_portal_provisioning.ts` for why a
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
 *
 * FF-EPIC-11-S4 adds two Authentik steps, treated very differently:
 *
 *   - `authentik_redirect_register` (AC1/AC3/AC4) is an INFRA step (same
 *     blocking/fail-loud contract as every step above it) — it registers the
 *     OIDC redirect URI for EVERY row currently in `portal_domains` for this
 *     portal via the existing `RedirectUriRegistrar` contract
 *     (`custom-domains/authentikRedirect.ts`, reused verbatim). Blocking is
 *     deliberate: an unregistered redirect URI is a silently broken login,
 *     which is exactly the failure mode AC4 forbids, so this step must
 *     succeed before the portal is allowed to reach
 *     `provisioned-pending-invite`.
 *   - `authentik_brand_register` (AC2) registers the portal's Authentik
 *     brand (login-page theming) via `authentik/portalBrand.ts`. Unlike the
 *     redirect step, this is treated exactly like `owner_invite` — recorded,
 *     independently retryable, but its failure never blocks or regresses the
 *     portal's status nor fails the overall `provisionPortal()` call, because
 *     losing branding is cosmetic, not a broken login.
 *
 * Both steps are no-ops (recorded `done`, no Authentik call made) while
 * `fuzefront.platform.multi-tenant-portals` is OFF — this pipeline already
 * runs regardless of that flag (see `index.ts`'s `ensureRootPortal` comment:
 * "runs regardless of the multi-tenant-portals flag ... creates dormant rows
 * nothing reads while the flag is off"), and these two steps follow the same
 * contract rather than making a live Authentik call for a portal nothing can
 * reach yet.
 */

export const PORTAL_PROVISIONING_STEPS = [
  'org_create',
  'permit_tenant_create',
  'permit_org_instance',
  'permit_org_parent',
  'portal_row_create',
  'default_domain_create',
  'authentik_redirect_register',
  'authentik_brand_register',
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
  /** FF-EPIC-11-S4 AC1 — registers a domain's OIDC redirect URI in Authentik. */
  redirectUris: RedirectUriRegistrar
  /** FF-EPIC-11-S4 AC2 — creates/updates the portal's Authentik login brand. */
  brandRegistrar: PortalBrandRegistrar
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

/**
 * Falls back to a no-op when Authentik is not configured for this
 * deployment (no `AUTHENTIK_ADMIN_TOKEN`) — mirrors
 * `custom-domains/authentikRedirect.ts`'s own degrade contract
 * (`createAuthentikRedirectRegistrar` returning `null`) so a deployment
 * without Authentik wired up gets "no redirect registered" instead of a
 * crash on every portal create.
 */
function defaultRedirectUriRegistrar(): RedirectUriRegistrar {
  const registrar = createAuthentikRedirectRegistrar()
  if (registrar) return registrar
  return {
    async register() {
      /* Authentik not configured — see doc comment above. */
    },
    async deregister() {
      /* Authentik not configured — see doc comment above. */
    },
  }
}

/** Same degrade-to-no-op contract as {@link defaultRedirectUriRegistrar}. */
function defaultBrandRegistrar(): PortalBrandRegistrar {
  const registrar = createAuthentikBrandRegistrar()
  if (registrar) return registrar
  return {
    async ensure() {
      /* Authentik not configured — see defaultRedirectUriRegistrar's doc. */
    },
  }
}

function getDeps(overrides?: Partial<PortalProvisioningDeps>): PortalProvisioningDeps {
  return {
    db: overrides?.db ?? defaultDb,
    permit: overrides?.permit ?? defaultPortalPermitClient,
    publish: overrides?.publish ?? defaultEventPublisher,
    redirectUris: overrides?.redirectUris ?? defaultRedirectUriRegistrar(),
    brandRegistrar: overrides?.brandRegistrar ?? defaultBrandRegistrar(),
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

/**
 * Defensive parse of `portals.branding` for the `authentik_brand_register`
 * step. The column is `jsonb`, written via `JSON.stringify` in
 * `portal_row_create` above, but knex/pg's driver may hand it back either as
 * an already-parsed object or as a raw string depending on connection pool
 * type-parser config — same ambiguity `portalRepository.ts`'s
 * `parseJsonColumnWithDefaults` guards against. Falls back to
 * `DEFAULT_BRANDING(name)` on anything unparseable so a malformed value never
 * throws out of this best-effort step.
 */
function parseBrandingColumn(value: unknown, name: string): PortalBranding {
  const fallback = DEFAULT_BRANDING(name)
  if (!value) return fallback
  if (typeof value === 'string') {
    try {
      return { ...fallback, ...JSON.parse(value) }
    } catch {
      return fallback
    }
  }
  if (typeof value === 'object') {
    return { ...fallback, ...(value as Partial<PortalBranding>) }
  }
  return fallback
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

    // `authentik_brand_register` is excluded here for the same reason
    // `owner_invite` is: cosmetic/independently-retryable, handled in its own
    // best-effort block below the completion checkpoint, never blocking.
    // `authentik_redirect_register` stays IN — see the module doc comment
    // (AC4 fail-loud contract).
    const INFRA_STEPS = PORTAL_PROVISIONING_STEPS.filter(
      s => s !== 'owner_invite' && s !== 'authentik_brand_register'
    )

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
          case 'authentik_redirect_register': {
            // No-op while the master flag is off — see the module doc
            // comment. Re-evaluated per attempt (not cached), same as every
            // other flag read in this codebase.
            if (await isMultiTenantPortalsEnabled()) {
              // AC3 — registers EVERY domain currently on this portal, not
              // just the primary one, so a portal with more than one
              // `portal_domains` row (e.g. a resumed run that now also has a
              // path/custom domain) gets a correct, independent redirect URI
              // for each. `register()` itself is idempotent (dedupes by
              // exact URL), so re-registering an already-registered domain
              // here is a safe no-op.
              const domainRows = await trx('portal_domains').where({ portal_id: portalId })
              for (const domainRow of domainRows) {
                await deps.redirectUris.register(domainRow.domain)
              }
            }
            break
          }
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

    // Authentik brand (AC2) — independently retryable, purely cosmetic
    // (branded login theming), so unlike `authentik_redirect_register` a
    // failure here must NOT block/regress the portal's status nor fail the
    // overall create call. AC4's fail-loud contract is scoped to the
    // redirect-URI step specifically, because that failure breaks login
    // outright; losing branding does not.
    const brandRow = stepRows['authentik_brand_register']
    if (brandRow?.status !== 'done') {
      try {
        if (portalRowBeforeInvite && (await isMultiTenantPortalsEnabled())) {
          const domainRows = await trx('portal_domains').where({ portal_id: portalId })
          const primaryDomain =
            domainRows.find((d: any) => d.is_primary)?.domain ?? domainRows[0]?.domain
          if (primaryDomain) {
            const branding = parseBrandingColumn(portalRowBeforeInvite.branding, input.name)
            await deps.brandRegistrar.ensure({
              domain: primaryDomain,
              name: branding.name,
              accent: branding.accent ?? null,
              logo: branding.logo ?? null,
              favicon: branding.favicon ?? null,
            })
          }
        }
        await markDone('authentik_brand_register')
      } catch (error: any) {
        await markFailed('authentik_brand_register', error)
        // Swallow — never fail the create call; cosmetic-only (see comment
        // above).
      }
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
