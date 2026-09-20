import type { Knex } from 'knex'
import { mintId, toUuid } from '@izzywdev/fuzefront-identity'
import { db as defaultDb } from '../config/database'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'
import {
  generatePortalId,
  getPortalDomains,
  rowToPortal,
  type PortalDto,
} from '../repositories/portalRepository'
import { rowToOrganization } from './organizationProvisioning'
import {
  defaultPortalPermitClient,
  type PortalProvisioningPermitClient,
} from './portalProvisioning'

/**
 * MendysRobotics tenant provisioning (Portals Directory).
 *
 * MendysRobotics is the platform's first `identity_mode: 'hard'` tenant — it
 * owns a dedicated Authentik instance and a custom front-door domain
 * (`marketplace.mendysrobotics.com`), deployed by
 * `deploy/helm/fuzefront/templates/authentik-mendys.yaml` +
 * `authentik/blueprints-mendys/`. Until now that silo existed ONLY at the
 * Authentik/Helm infra layer: migration `023_portals_identity_mode.ts` merely
 * *updates* a Mendys `portals` row to `'hard'` "once one exists (by this or a
 * future migration/seed)" — and none ever created it. So the master-admin
 * Portals Directory (`GET /api/v1/admin/portals`) only ever listed the root
 * `fuzefront` portal; there was no second row to show.
 *
 * This is that "future seed". It idempotently ensures the MendysRobotics
 * portal exists as a proper tenant: its own organization silo (child of the
 * root org), a Permit tenant + Organization ReBAC instance parented to root
 * (so a root-scoped master-admin's `canRead` reaches it under the flag-ON
 * per-portal authorization in `adminPortals.ts`), the `portals` row itself
 * (`identity_mode: 'hard'`, `status: 'active'`), and its custom primary
 * domain. It mirrors `ensureRootPortal()`'s direct-idempotent-insert style
 * rather than replaying `provisionPortal()`'s full pipeline, because at boot
 * we want no owner-invite emails / event-outbox side effects — just the rows.
 *
 * GATED on `MENDYS_PORTAL_PROVISION === 'true'` (set by `backend.yaml` only
 * when `.Values.authentikMendys.enabled`), so local/CI and any deployment
 * without the Mendys silo stay untouched — no dangling `'hard'` portal whose
 * Authentik does not exist.
 */

export const MENDYS_PORTAL_SLUG = 'mendysrobotics'
export const MENDYS_PORTAL_DOMAIN = 'marketplace.mendysrobotics.com'
/** Namespaced like `provisionPortal`'s `portal-${slug}` so it never collides
 * with an unrelated org's slug (organizations.slug has its own unique index). */
export const MENDYS_ORG_SLUG = `portal-${MENDYS_PORTAL_SLUG}`

const MENDYS_NAME = 'MendysRobotics'

export function isMendysPortalProvisionEnabled(): boolean {
  return process.env.MENDYS_PORTAL_PROVISION === 'true'
}

const MENDYS_BRANDING = {
  name: MENDYS_NAME,
  logo: null,
  favicon: null,
  accent: null,
  tagline: null,
}

const MENDYS_IDENTITY_POLICY = {
  allowPasswordLogin: true,
  allowSelfSignup: false,
  mfaRequired: false,
  ssoProviders: [],
}

/**
 * Idempotently ensures the MendysRobotics tenant portal exists. No-op (returns
 * null) when the gate env is unset, or on a completely fresh install with no
 * user yet to own the org (self-heals on a later boot, exactly like
 * `ensureRootPortal`). Permit failures are logged and swallowed — a Permit
 * outage must never block boot; the next boot re-runs these idempotent steps.
 */
export async function ensureMendysPortal(
  db: Knex = defaultDb,
  permit: PortalProvisioningPermitClient = defaultPortalPermitClient
): Promise<PortalDto | null> {
  if (!isMendysPortalProvisionEnabled()) return null

  // Owner resolution: first admin, else first user. Fresh install (no users)
  // → no-op, retried next boot — same tolerance as ensureRootPortal.
  const admin = await db('users')
    .whereRaw(`roles::text LIKE ?`, ['%admin%'])
    .orderBy('created_at', 'asc')
    .first()
  const owner = admin ?? (await db('users').orderBy('created_at', 'asc').first())
  if (!owner) return null

  // 1. Org silo — a child of the root platform org, idempotent by slug.
  let orgRow = await db('organizations').where({ slug: MENDYS_ORG_SLUG }).first()
  if (!orgRow) {
    await db('organizations')
      .insert({
        id: toUuid(mintId('organization')),
        name: MENDYS_NAME,
        slug: MENDYS_ORG_SLUG,
        parent_id: ROOT_ORG_ID,
        owner_id: owner.id,
        type: 'organization',
        settings: JSON.stringify({}),
        metadata: JSON.stringify({ portalSlug: MENDYS_PORTAL_SLUG }),
        is_active: true,
        provisioning_state: 'active',
      })
      .onConflict('slug')
      .ignore()
    orgRow = await db('organizations').where({ slug: MENDYS_ORG_SLUG }).first()
  }
  if (!orgRow) {
    throw new Error('ensureMendysPortal: failed to create or locate the Mendys organization')
  }

  // 2. Permit tenant + Organization ReBAC instance + parent link. Best-effort:
  //    each is idempotent server-side and non-fatal (matches provisionPortal's
  //    swallow-and-self-heal posture for Permit) so a PDP/API outage at boot
  //    never crashes the platform.
  const orgDto = rowToOrganization(orgRow)
  try {
    await permit.createTenant(orgDto)
  } catch (error) {
    console.warn('ensureMendysPortal: permit.createTenant failed (non-fatal)', error)
  }
  try {
    await permit.createOrgInstance(orgDto)
  } catch (error) {
    console.warn('ensureMendysPortal: permit.createOrgInstance failed (non-fatal)', error)
  }
  try {
    if (orgRow.id !== ROOT_ORG_ID) {
      await permit.linkParent(orgDto, ROOT_ORG_ID)
    }
  } catch (error) {
    console.warn('ensureMendysPortal: permit.linkParent failed (non-fatal)', error)
  }

  // 3. Portal row — hard identity, active, reseller billing. Idempotent by
  //    slug; if a prior row exists in a weaker shape (e.g. a stray 'soft'/
  //    'provisioning' row) reconcile it to the intended terminal state.
  let portalRow = await db('portals').where({ slug: MENDYS_PORTAL_SLUG }).first()
  if (!portalRow) {
    await db('portals')
      .insert({
        id: generatePortalId(),
        organization_id: orgRow.id,
        slug: MENDYS_PORTAL_SLUG,
        name: MENDYS_NAME,
        status: 'active',
        billing_mode: 'reseller',
        branding: JSON.stringify(MENDYS_BRANDING),
        identity_policy: JSON.stringify(MENDYS_IDENTITY_POLICY),
        owner_email: null,
        is_root: false,
        identity_mode: 'hard',
      })
      .onConflict('slug')
      .ignore()
    portalRow = await db('portals').where({ slug: MENDYS_PORTAL_SLUG }).first()
  } else if (portalRow.identity_mode !== 'hard' || portalRow.status !== 'active') {
    await db('portals')
      .where({ id: portalRow.id })
      .update({ identity_mode: 'hard', status: 'active', updated_at: db.fn.now() })
    portalRow = await db('portals').where({ id: portalRow.id }).first()
  }
  if (!portalRow) {
    throw new Error('ensureMendysPortal: portal row missing after insert')
  }

  // 4. Custom primary domain (marketplace.mendysrobotics.com). Idempotent by
  //    domain (portal_domains.domain is globally unique). Verified/issued: it
  //    is a Mendys-owned host fronted by its own Authentik silo, not a
  //    platform subdomain pending DNS verification.
  const existingDomain = await db('portal_domains')
    .where({ domain: MENDYS_PORTAL_DOMAIN })
    .first()
  if (!existingDomain) {
    await db('portal_domains')
      .insert({
        portal_id: portalRow.id,
        domain: MENDYS_PORTAL_DOMAIN,
        kind: 'custom',
        is_primary: true,
        verification_status: 'verified',
        tls_status: 'issued',
      })
      .onConflict('domain')
      .ignore()
  }

  const domains = await getPortalDomains(portalRow.id, db)
  return rowToPortal(portalRow, domains)
}
