import { v4 as uuidv4 } from 'uuid'
import type { Knex } from 'knex'
import { db as defaultDb } from '../config/database'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'

/**
 * Data access + row<->DTO mapping for `portals`/`portal_domains`
 * (FF-EPIC-09-S1 / FF-EPIC-10-S1). Every DTO shape here matches the FROZEN
 * `services/portal-service/openapi.yaml` contract exactly (camelCase field
 * names) — the generated `@fuzefront/portal-client` types are the source of
 * truth this module targets.
 */

export const ROOT_PORTAL_SLUG = 'fuzefront'
export const ROOT_PORTAL_ID = 'prt_fuzefront'

export type PortalStatus =
  | 'provisioning'
  | 'provisioned-pending-invite'
  | 'active'
  | 'suspended'

export type BillingMode = 'free' | 'platform' | 'reseller'
export type DomainKind = 'subdomain' | 'path' | 'custom'
export type VerificationStatus = 'pending' | 'verified' | 'failed'
export type TlsStatus = 'none' | 'pending' | 'issued' | 'failed'
/**
 * Portals Directory (backend slice S1) — whether a portal shares the root
 * FuzeFront Authentik directory (`soft`, the default) or owns a dedicated
 * Authentik instance (`hard`, e.g. MendysRobotics — see migration
 * `023_portals_identity_mode.ts` for the full rationale). Not yet part of
 * `PortalDto`/the frozen `services/portal-service/openapi.yaml` `Portal`
 * schema for every portal endpoint — currently surfaced ONLY on
 * `GET /api/v1/admin/portals` (the fleet list), behind
 * `fuzefront.platform.portals-directory`, via `getPortalIdentityMode` below.
 */
export type IdentityMode = 'soft' | 'hard'

export interface PortalBranding {
  name: string
  logo?: string | null
  favicon?: string | null
  accent?: string | null
  tagline?: string | null
}

export interface PortalIdentityPolicy {
  allowPasswordLogin: boolean
  allowSelfSignup: boolean
  mfaRequired?: boolean
  ssoProviders?: string[]
  /**
   * FF-EPIC-11-S5 — INTERNAL/admin-only opt-in allowing a platform (root-org)
   * administrator to authenticate into THIS tenant portal for support
   * purposes, bypassing the normal home_portal_id-based cross-portal login
   * rejection (`resolvePortalBindingForLogin`, `routes/auth.ts`). Every
   * exercise of this path is audit-logged.
   *
   * Absent/undefined ⇒ false (default OFF — a portal must explicitly opt in;
   * see `services/portalProvisioning.ts`'s + this module's own
   * `DEFAULT_IDENTITY_POLICY`, neither of which sets this key). A portal's
   * caller must never infer permissiveness from a missing/malformed
   * `identity_policy` column — see `getPortalIdentityPolicy` below, which
   * fails closed to the default (this field absent) on any parse failure.
   *
   * Deliberately NOT surfaced on the PUBLIC pre-auth boot payload
   * (`rowToPortalContext` / `GET /api/v1/portal/context`) — that projection
   * explicitly whitelists only the fields `services/portal-service/openapi.yaml`'s
   * `PortalIdentityPolicy` schema documents as public; this field is
   * additive to that schema but intentionally excluded from that specific
   * projection so an unauthenticated visitor can never discover whether a
   * portal has support access enabled.
   */
  allowPlatformAdminSupportAccess?: boolean
}

export interface PortalDomainDto {
  id: string
  portalId: string
  domain: string
  kind: DomainKind
  verificationStatus: VerificationStatus
  tlsStatus: TlsStatus
  isPrimary: boolean
  createdAt: string
}

export interface PortalDto {
  id: string
  slug: string
  name: string
  status: PortalStatus
  isRoot: boolean
  organizationId: string
  ownerEmail: string | null
  billingMode: BillingMode
  branding: PortalBranding
  identityPolicy: PortalIdentityPolicy
  domains: PortalDomainDto[]
  primaryDomain: string | null
  createdAt: string
  updatedAt: string
}

export interface PortalContextDto {
  id: string
  slug: string
  isRoot: boolean
  branding: PortalBranding
  identityPolicy: PortalIdentityPolicy
  authEntry: {
    loginUrl: string
    signupUrl: string | null
    forgotPasswordUrl: string | null
    ssoProviders: Array<{ id: string; label: string; startUrl: string }>
  }
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

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'object') return value as T
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

/**
 * Shallow-merges a parsed jsonb column over its defaults so a partially-stored
 * object (e.g. an admin PATCH that only set `accent`) still returns a
 * fully-shaped DTO — every optional field has the documented contract
 * fallback (never a broken/missing key on the wire).
 */
function parseJsonColumnWithDefaults<T extends Record<string, any>>(
  value: unknown,
  fallback: T
): T {
  const parsed = parseJsonColumn<Partial<T>>(value, {})
  return { ...fallback, ...parsed }
}

/**
 * Parses a raw `portals` row's `identity_policy` column into a fully-shaped
 * `PortalIdentityPolicy`, fail-closed on missing/malformed JSON (falls back
 * to `DEFAULT_IDENTITY_POLICY`, which never sets `allowPlatformAdminSupportAccess`
 * — so a broken column can never be read as permissive). The single shared
 * parser every non-DTO consumer (e.g. the FF-EPIC-11-S5 cross-portal login
 * support-access check in `routes/auth.ts`) should use rather than
 * re-implementing jsonb parsing ad hoc.
 */
export function getPortalIdentityPolicy(row: { identity_policy?: unknown }): PortalIdentityPolicy {
  return parseJsonColumnWithDefaults(row.identity_policy, DEFAULT_IDENTITY_POLICY)
}

/**
 * Generates a storage-form portal id (bare UUID v4 with dashes).
 *
 * Previously returned `prt_<hex32>` (UUID with dashes stripped). That legacy
 * format is converted to bare UUID by migration 024_portal_typeid_backfill.
 * New portals minted from this point forward store a bare UUID directly —
 * consistent with the identifier standard (governance/identifier-standard.md
 * §2) and with every other entity type. The `prt_` prefix appears only on the
 * wire via `toWireId` when `fuzefront.identity.prefixed-ids` is ON.
 */
export function generatePortalId(): string {
  return uuidv4()
}

/**
 * The platform-owned base domain the `default_domain_create` provisioning
 * step (`services/portalProvisioning.ts`) always creates a portal's default
 * subdomain under (`<slug>.<PORTAL_DEFAULT_BASE_DOMAIN>`). Single source of
 * truth for that literal so `getPortalLaunchUrl` below never drifts from the
 * value provisioning actually writes to `portal_domains`.
 */
export const PORTAL_DEFAULT_BASE_DOMAIN = 'fuzefront.com'

/**
 * Reads a raw `portals` row's `identity_mode` column, fail-closed to `soft`
 * on any missing/unrecognized value (mirrors `getPortalIdentityPolicy`'s
 * fail-closed-to-default convention) — a broken/legacy column can never be
 * misread as the more privileged/dedicated `hard` mode.
 */
export function getPortalIdentityMode(row: { identity_mode?: unknown }): IdentityMode {
  return row.identity_mode === 'hard' ? 'hard' : 'soft'
}

/**
 * Portals Directory (backend slice S1) — derives the master-admin fleet
 * list's `launchUrl`: `https://<primary domain>` when the portal has one
 * (reuses `rowToPortal`'s own `primaryDomain` projection rather than
 * re-querying `portal_domains`), else falls back to the portal's default
 * platform-owned subdomain (`https://<slug>.<PORTAL_DEFAULT_BASE_DOMAIN>`) —
 * the same value `default_domain_create` provisions for every portal, so the
 * fallback always resolves even before that row has landed/replicated.
 */
export function getPortalLaunchUrl(portal: {
  slug: string
  primaryDomain: string | null
}): string {
  const host = portal.primaryDomain ?? `${portal.slug}.${PORTAL_DEFAULT_BASE_DOMAIN}`
  return `https://${host}`
}

export function rowToPortalDomain(row: any): PortalDomainDto {
  return {
    id: row.id,
    portalId: row.portal_id,
    domain: row.domain,
    kind: row.kind,
    verificationStatus: row.verification_status,
    tlsStatus: row.tls_status,
    isPrimary: !!row.is_primary,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export function rowToPortal(row: any, domainRows: any[] = []): PortalDto {
  const domains = domainRows.map(rowToPortalDomain)
  const primary = domains.find(d => d.isPrimary) ?? domains[0]
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    isRoot: !!row.is_root,
    organizationId: row.organization_id,
    ownerEmail: row.owner_email ?? null,
    billingMode: row.billing_mode,
    branding: parseJsonColumnWithDefaults(row.branding, DEFAULT_BRANDING(row.name)),
    identityPolicy: parseJsonColumnWithDefaults(row.identity_policy, DEFAULT_IDENTITY_POLICY),
    domains,
    primaryDomain: primary?.domain ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/**
 * Projects a full portal row to the PUBLIC boot payload
 * (`GET /api/v1/portal/context`) — id/slug/branding/identityPolicy/authEntry
 * ONLY. Never leaks organizationId, ownerEmail, billingMode, or domains; the
 * contract is explicit that this endpoint is intentionally public/pre-auth.
 */
export function rowToPortalContext(row: any): PortalContextDto {
  const branding = parseJsonColumnWithDefaults<PortalBranding>(
    row.branding,
    DEFAULT_BRANDING(row.name)
  )
  const identityPolicy = parseJsonColumnWithDefaults<PortalIdentityPolicy>(
    row.identity_policy,
    DEFAULT_IDENTITY_POLICY
  )
  const slug = row.slug as string
  const base = slug === ROOT_PORTAL_SLUG ? '' : `/p/${slug}`
  return {
    id: row.id,
    slug,
    isRoot: !!row.is_root,
    branding,
    // FF-EPIC-11-S5 — explicitly whitelisted to the PUBLIC contract fields
    // only (services/portal-service/openapi.yaml's PortalIdentityPolicy
    // schema). `identityPolicy` here is the fully-parsed internal shape and
    // may carry admin-only fields (e.g. allowPlatformAdminSupportAccess) that
    // must never reach this unauthenticated pre-auth boot payload.
    identityPolicy: {
      allowPasswordLogin: identityPolicy.allowPasswordLogin,
      allowSelfSignup: identityPolicy.allowSelfSignup,
      mfaRequired: identityPolicy.mfaRequired,
      ssoProviders: identityPolicy.ssoProviders,
    },
    authEntry: {
      loginUrl: `${base}/login`,
      signupUrl: identityPolicy.allowSelfSignup ? `${base}/signup` : null,
      forgotPasswordUrl: identityPolicy.allowPasswordLogin
        ? `${base}/forgot-password`
        : null,
      ssoProviders: [],
    },
  }
}

/**
 * The `GET /api/v1/portal/context` response during BOOTSTRAP MODE (flag ON,
 * but `ensureRootPortal()` hasn't seeded the root portal yet — a fresh
 * install with no users at all, see middleware/portalContext.ts). There is
 * genuinely no portal row to project yet, but the shell still needs SOMETHING
 * contract-valid to paint a login screen with — this is the platform's own
 * generic default (never a specific tenant's data). `id` is a fixed,
 * well-known sentinel (matches the `PortalId` pattern, but resolves to no
 * real `portals` row) so callers can distinguish it if they need to.
 */
export function bootstrapPortalContext(): PortalContextDto {
  return {
    id: 'prt_bootstrap',
    slug: ROOT_PORTAL_SLUG,
    isRoot: true,
    branding: DEFAULT_BRANDING('FuzeFront'),
    identityPolicy: DEFAULT_IDENTITY_POLICY,
    authEntry: {
      loginUrl: '/login',
      signupUrl: null,
      forgotPasswordUrl: '/forgot-password',
      ssoProviders: [],
    },
  }
}

export async function getPortalDomains(
  portalId: string,
  db: Knex = defaultDb
): Promise<any[]> {
  return db('portal_domains').where({ portal_id: portalId }).orderBy('created_at', 'asc')
}

export async function findPortalById(
  portalId: string,
  db: Knex = defaultDb
): Promise<any | undefined> {
  return db('portals').where({ id: portalId }).first()
}

export async function findPortalBySlug(
  slug: string,
  db: Knex = defaultDb
): Promise<any | undefined> {
  return db('portals').where({ slug }).first()
}

export async function findPortalByDomain(
  host: string,
  db: Knex = defaultDb
): Promise<any | undefined> {
  const domainRow = await db('portal_domains')
    .whereIn('kind', ['subdomain', 'custom'])
    .andWhere({ domain: host.toLowerCase() })
    .first()
  if (!domainRow) return undefined
  return findPortalById(domainRow.portal_id, db)
}

export async function getRootPortal(db: Knex = defaultDb): Promise<any | undefined> {
  return db('portals').where({ slug: ROOT_PORTAL_SLUG }).first()
}

/**
 * Idempotently ensures the seeded root portal (slug `fuzefront`) exists,
 * mapped 1:1 to "the root organization" (FF-EPIC-09-S1 AC2).
 *
 * Root-organization resolution rule (this codebase has no pre-existing single
 * "root org" concept — see the epic's own documented risk/assumption): the
 * oldest `organizations` row of `type = 'platform'`. If none exists yet and at
 * least one user exists, a platform org is created and owned by the first
 * admin user (or, absent an admin, the first user) — mirroring
 * `ensurePersonalOrg`'s self-healing style. If no user exists yet (a
 * completely fresh install, before the first login/seed), this is a no-op
 * (returns null) so it can be retried on the next boot.
 *
 * FAIL-LOUD case (AC4): if a root portal ROW already exists but its
 * `organization_id` no longer resolves to a real `organizations` row (a
 * legacy/corrupted DB), this throws rather than silently creating a second,
 * orphaned root portal.
 */
export async function ensureRootPortal(
  db: Knex = defaultDb
): Promise<PortalDto | null> {
  const existing = await getRootPortal(db)
  if (existing) {
    const org = await db('organizations').where({ id: existing.organization_id }).first()
    if (!org) {
      throw new Error(
        `ensureRootPortal: root portal ${existing.id} references missing organization ` +
          `${existing.organization_id} — refusing to auto-repair (legacy/corrupted DB)`
      )
    }
    const domains = await getPortalDomains(existing.id, db)
    return rowToPortal(existing, domains)
  }

  // Prefer the FIXED root-org id seeded by migration 015. The oldest-platform-org
  // fallback stays for databases that predate it (their root was created by an
  // earlier ensureRootPortal() under a random id, and rows already reference it).
  let rootOrg =
    (await db('organizations').where({ id: ROOT_ORG_ID }).first()) ??
    (await db('organizations')
      .where({ type: 'platform' })
      .orderBy('created_at', 'asc')
      .first())

  if (!rootOrg) {
    const admin = await db('users')
      .whereRaw(`roles::text LIKE ?`, ['%admin%'])
      .orderBy('created_at', 'asc')
      .first()
    const anyUser = admin ?? (await db('users').orderBy('created_at', 'asc').first())
    if (!anyUser) {
      // Fresh install, no users yet — nothing to own the root org. Self-heals
      // on a later boot once at least one user exists.
      return null
    }

    const orgId = ROOT_ORG_ID
    await db('organizations')
      .insert({
        id: orgId,
        name: 'FuzeFront',
        slug: ROOT_PORTAL_SLUG,
        parent_id: null,
        owner_id: anyUser.id,
        type: 'platform',
        settings: JSON.stringify({}),
        metadata: JSON.stringify({ root: true }),
        is_active: true,
        provisioning_state: 'active',
      })
      .onConflict('slug')
      .ignore()

    rootOrg = await db('organizations').where({ type: 'platform' }).orderBy('created_at', 'asc').first()
    if (!rootOrg) {
      throw new Error('ensureRootPortal: failed to create or locate a platform organization')
    }
  }

  const branding = DEFAULT_BRANDING('FuzeFront')
  const inserted = {
    id: ROOT_PORTAL_ID,
    organization_id: rootOrg.id,
    slug: ROOT_PORTAL_SLUG,
    name: 'FuzeFront',
    status: 'active',
    billing_mode: 'platform',
    branding: JSON.stringify(branding),
    identity_policy: JSON.stringify(DEFAULT_IDENTITY_POLICY),
    owner_email: null,
    is_root: true,
  }

  await db('portals').insert(inserted).onConflict('slug').ignore()

  const created = await getRootPortal(db)
  if (!created) {
    throw new Error('ensureRootPortal: insert reported success but root portal row is missing')
  }
  const domains = await getPortalDomains(created.id, db)
  return rowToPortal(created, domains)
}
