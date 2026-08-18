/**
 * FF-EPIC-17-S7 — portal CRUD as org-tree operations.
 *
 * Frozen contract: `packages/security/openapi.yaml` tag `portals` (PR #704,
 * `@fuzefront/security-client` 0.7.0). A "portal" is an `organizations` row
 * whose `parent_id` is the platform root (`ROOT_ORG_ID`) AND that carries a
 * row in the NEW `organization_portal_attributes` extension table (migration
 * 016) — the portal-root attribute + tenant attributes (custom domain /
 * white-label branding / per-portal app-catalog mode / reseller billing
 * mode) that ordinary sub-orgs lack. NOT a `portals`-table CRUD — that
 * standalone model (`backend/src/routes/adminPortals.ts` /
 * `GET /api/v1/admin/portals`) is superseded by this contract but is left
 * running unchanged in this PR (retiring it is a separate follow-up).
 *
 * Every operation is platform-admin-only, fail-closed: gated behind
 * `fuzefront.platform.multi-tenant-portals` (flag OFF => 404, zero DB
 * access, exactly as if the route did not exist — mirrors
 * `routes/organizations.ts`'s `/directory` and `routes/security.ts`'s
 * `/employee/*` convention) AND behind the SAME Permit ReBAC
 * `org-admin`-on-root derivation the rest of the org tree uses
 * (`resolveEmployeeStatus` — see `services/employeeRole.ts`; "platform admin"
 * here is exactly "Employee" as that module defines it). A non-platform-admin
 * caller gets 403 FORBIDDEN. An id is never a capability — authorization is
 * always the token + Permit, never knowledge of a `portalOrgId`.
 *
 * Portal creation reuses `services/organizationProvisioning.ts`'s resumable
 * reconcile backbone (`reconcileOrganizationProvisioning`) — the SAME
 * pattern `routes/organizations.ts`'s `POST /` uses for an ordinary org — NOT
 * the monolith's more elaborate Authentik-aware `portalProvisioning.ts`
 * pipeline (portal_domains, custom-domain redirects, Authentik branding),
 * which is out of scope for this story's five endpoints. One consequence:
 * `PortalCreate.ownerEmail` is stored as an informational tenant attribute
 * (surfaced back as `Portal.ownerEmail`) but the actual DB `owner_id` FK (and
 * therefore the reconciler's Permit-role-assign + welcome-email steps) is the
 * PLATFORM ADMIN who called this endpoint — inviting the named owner and
 * transferring ownership to them is a follow-up (there is no accept-invite
 * endpoint in this contract).
 */
import express from 'express'
import { mintId, toUuid, fromUuid } from '@izzywdev/fuzefront-identity'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import { enqueueEvent } from '@fuzefront/core'
import { TOPICS } from '@fuzefront/shared/kafka'
import { resolveEmployeeStatus } from '../services/employeeRole'
import { isMultiTenantPortalsEnabled } from '../utils/multiTenantPortalsFlag'
import { reconcileOrganizationProvisioning } from '../services/organizationProvisioning'
import { ROOT_ORG_ID } from '../migrations/014_seed_root_platform_organization'

const router = express.Router()

// ── shared helpers ──────────────────────────────────────────────────────────

function parseJsonb(value: any): any {
  if (value === null || value === undefined) return {}
  if (typeof value === 'string') return JSON.parse(value || '{}')
  return value
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLUG_RE = /^[a-zA-Z0-9_-]+$/
const PORTAL_STATUSES = ['provisioning', 'provisioned-pending-invite', 'active', 'suspended']
const BILLING_MODES = ['free', 'platform', 'reseller']
const APP_CATALOG_MODES = ['inherit', 'custom']

/**
 * Flag-gate + platform-admin authz, shared by every route below. Flag OFF
 * renders 404 with zero DB access; flag ON but non-platform-admin renders 403
 * FORBIDDEN. Returns the resolved employee status on success so callers don't
 * re-derive it, or `null` if the response has already been sent.
 */
async function requirePlatformAdmin(req: any, res: any): Promise<boolean> {
  const enabled = await isMultiTenantPortalsEnabled({ userId: req.user?.id })
  if (!enabled) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' })
    return false
  }
  const status = await resolveEmployeeStatus(req.user.id)
  if (!status.isEmployee) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' })
    return false
  }
  return true
}

interface PortalRow {
  id: string
  name: string
  slug: string
  parent_id: string | null
  is_active: boolean
  created_at: Date | string
  updated_at: Date | string
  branding: any
  billing_mode: string
  app_catalog_mode: string
  owner_email: string | null
  custom_domain: string | null
  status: string
}

function rowToPortalDto(row: PortalRow) {
  const branding = parseJsonb(row.branding)
  return {
    orgId: row.id,
    parentOrgId: row.parent_id,
    name: row.name,
    slug: row.slug,
    kind: 'portal' as const,
    status: row.status,
    isPortalRoot: true,
    ownerEmail: row.owner_email ?? null,
    customDomain: row.custom_domain ?? null,
    branding: {
      name: branding?.name ?? row.name,
      logo: branding?.logo ?? null,
      favicon: branding?.favicon ?? null,
      accent: branding?.accent ?? null,
      tagline: branding?.tagline ?? null,
    },
    billingMode: row.billing_mode,
    appCatalogMode: row.app_catalog_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// The base join every route below reads from — a "portal" is precisely an
// org row that has a matching extension-table row, so the JOIN itself is the
// portal-eligibility check (AC1/AC3: the root never has one, so it can never
// be returned by any of these routes).
const PORTAL_SELECT_COLUMNS = [
  'o.id',
  'o.name',
  'o.slug',
  'o.parent_id',
  'o.is_active',
  'o.created_at',
  'o.updated_at',
  'a.branding',
  'a.billing_mode',
  'a.app_catalog_mode',
  'a.owner_email',
  'a.custom_domain',
  'a.status',
]

function portalBaseQuery() {
  return db('organizations as o')
    .join('organization_portal_attributes as a', 'a.organization_id', 'o.id')
    .select(PORTAL_SELECT_COLUMNS)
}

// ── list pagination (cursor = created_at + id tiebreaker, family standard) ──

const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 200

function parseListLimit(raw: any): number {
  const n = parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 1) return LIST_DEFAULT_LIMIT
  return Math.min(n, LIST_MAX_LIMIT)
}

function encodePortalCursor(row: { created_at: Date | string; id: string }): string {
  const iso = row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  return Buffer.from(`${iso}|${row.id}`, 'utf8').toString('base64url')
}

function decodePortalCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const idx = decoded.indexOf('|')
    if (idx < 0) return null
    const createdAt = decoded.slice(0, idx)
    const id = decoded.slice(idx + 1)
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /portals — list (root never listed; cursor-paginated)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portals', authenticateToken, async (req: any, res) => {
  try {
    if (!(await requirePlatformAdmin(req, res))) return

    const limit = parseListLimit(req.query.limit)

    let cursorValue: { createdAt: string; id: string } | null = null
    if (req.query.cursor) {
      cursorValue = decodePortalCursor(String(req.query.cursor))
      if (!cursorValue) {
        return res.status(400).json({ error: 'Invalid cursor', code: 'MALFORMED' })
      }
    }

    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined
    if (statusFilter && !PORTAL_STATUSES.includes(statusFilter)) {
      return res.status(400).json({ error: 'Invalid status filter', code: 'MALFORMED' })
    }

    let query = portalBaseQuery().where('o.parent_id', ROOT_ORG_ID)
    if (statusFilter) {
      query = query.where('a.status', statusFilter)
    }
    if (cursorValue) {
      // Keyset row-value comparison on the SAME (created_at, id) tuple the
      // ORDER BY below sorts by — pages the full set with no gaps/dupes under
      // concurrent writes (family pagination standard).
      query = query.whereRaw('(o.created_at, o.id) > (?, ?)', [cursorValue.createdAt, cursorValue.id])
    }

    const rows: PortalRow[] = await query
      .orderBy('o.created_at', 'asc')
      .orderBy('o.id', 'asc')
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? encodePortalCursor(page[page.length - 1]) : null

    res.status(200).json({
      items: page.map(rowToPortalDto),
      page: { nextCursor, hasMore },
    })
  } catch (error: any) {
    console.error('[security] Error listing portals:', error)
    res.status(500).json({ error: 'Failed to list portals' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /portals — create (service mints id; org child of the platform root)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/portals', authenticateToken, async (req: any, res) => {
  try {
    if (!(await requirePlatformAdmin(req, res))) return

    const body = req.body || {}
    const errors: string[] = []

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 120) {
      errors.push('name is required and must be 1-120 characters')
    }

    const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
    if (!slug || !SLUG_RE.test(slug)) {
      errors.push('slug is required and must contain only letters, numbers, hyphens, and underscores')
    }

    const ownerEmail = typeof body.ownerEmail === 'string' ? body.ownerEmail.trim() : ''
    if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) {
      errors.push('ownerEmail is required and must be a valid email address')
    }

    const billingMode = body.billingMode ?? 'free'
    if (!BILLING_MODES.includes(billingMode)) {
      errors.push(`billingMode must be one of ${BILLING_MODES.join(', ')}`)
    }

    const appCatalogMode = body.appCatalogMode ?? 'inherit'
    if (!APP_CATALOG_MODES.includes(appCatalogMode)) {
      errors.push(`appCatalogMode must be one of ${APP_CATALOG_MODES.join(', ')}`)
    }

    const customDomain =
      body.customDomain === null || body.customDomain === undefined
        ? null
        : typeof body.customDomain === 'string'
          ? body.customDomain.trim()
          : (errors.push('customDomain must be a string or null'), null)

    let branding: { name: string; logo: string | null; favicon: string | null; accent: string | null; tagline: string | null }
    if (body.branding !== undefined) {
      if (typeof body.branding !== 'object' || body.branding === null || Array.isArray(body.branding)) {
        errors.push('branding must be an object')
        branding = { name, logo: null, favicon: null, accent: null, tagline: null }
      } else if (typeof body.branding.name !== 'string' || !body.branding.name.trim()) {
        errors.push('branding.name is required when branding is provided')
        branding = { name, logo: null, favicon: null, accent: null, tagline: null }
      } else {
        branding = {
          name: body.branding.name.trim(),
          logo: body.branding.logo ?? null,
          favicon: body.branding.favicon ?? null,
          accent: body.branding.accent ?? null,
          tagline: body.branding.tagline ?? null,
        }
      }
    } else {
      branding = { name, logo: null, favicon: null, accent: null, tagline: null }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', code: 'MALFORMED', details: errors })
    }

    // Pre-check for a friendlier 409 than the raw unique-constraint race below
    // (organizations.slug is globally unique across the whole org tree, so a
    // portal slug collides with ANY existing org, not just other portals).
    const existingOrg = await db('organizations').where('slug', slug).first()
    if (existingOrg) {
      return res.status(409).json({ error: 'A portal with this slug already exists', code: 'CONFLICT' })
    }

    // Service mints the id — the request body carries no `id` (identifier
    // standard: the owning service is the only sanctioned constructor).
    const organizationId = toUuid(mintId('organization'))

    try {
      await db.transaction(async trx => {
        await trx('organizations').insert({
          id: organizationId,
          name,
          slug,
          parent_id: ROOT_ORG_ID,
          // The platform admin who called this endpoint owns the org row (FK
          // NOT NULL) — see the module doc's ownerEmail tradeoff. `ownerEmail`
          // itself is stored below as an informational tenant attribute.
          owner_id: req.user.id,
          type: 'organization',
          settings: JSON.stringify({}),
          metadata: JSON.stringify({ isPortalRoot: true }),
          is_active: true,
          provisioning_state: 'pending',
        })

        await trx('organization_memberships').insert({
          id: toUuid(mintId('membership')),
          user_id: req.user.id,
          organization_id: organizationId,
          role: 'owner',
          status: 'active',
          joined_at: new Date(),
          permissions: JSON.stringify({}),
          metadata: JSON.stringify({}),
        })

        await trx('organization_portal_attributes').insert({
          organization_id: organizationId,
          custom_domain: customDomain,
          branding: JSON.stringify(branding),
          billing_mode: billingMode,
          app_catalog_mode: appCatalogMode,
          owner_email: ownerEmail,
          is_portal_root: true,
          status: 'provisioning',
        })

        await enqueueEvent(
          trx,
          TOPICS.IDENTITY_ORG_CREATED,
          {
            organizationId,
            slug,
            name,
            type: 'organization',
            parentId: ROOT_ORG_ID,
            ownerId: req.user.id,
            isActive: true,
            settings: {},
            metadata: { isPortalRoot: true },
          },
          `identity-org-created-${organizationId}`
        )
      })
    } catch (error: any) {
      if (error.code === '23505' || error.message?.includes('duplicate key')) {
        return res.status(409).json({ error: 'A portal with this slug already exists', code: 'CONFLICT' })
      }
      throw error
    }

    // Reuse the SAME resumable provisioning backbone ordinary org creation
    // uses (routes/organizations.ts POST /). A Permit outage must not 500 the
    // create — the org is left `pending` and self-heals on the next reconcile
    // (login self-heal or the internal provision endpoint), so reconciler
    // errors are swallowed here, mirroring the ordinary-org create path.
    try {
      await reconcileOrganizationProvisioning(fromUuid('organization', organizationId))
    } catch (error) {
      console.error(
        `[security] Portal provisioning reconcile failed for org ${organizationId} (will self-heal):`,
        error
      )
    }

    const finalOrg = await db('organizations').where('id', organizationId).first()
    // Only flip the attribute status to 'active' once every reconcile step is
    // actually done — a failed/pending reconcile leaves the portal
    // 'provisioning' (this backbone has no 'provisioned-pending-invite'
    // state; see the module doc).
    if (finalOrg?.provisioning_state === 'active') {
      await db('organization_portal_attributes')
        .where('organization_id', organizationId)
        .update({ status: 'active', updated_at: new Date() })
    }

    const created = await portalBaseQuery().where('o.id', organizationId).first()
    res.status(201).json(rowToPortalDto(created))
  } catch (error: any) {
    console.error('[security] Error creating portal:', error)
    res.status(500).json({ error: 'Failed to create portal' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /portals/:portalOrgId — read one
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portals/:portalOrgId', authenticateToken, async (req: any, res) => {
  try {
    if (!(await requirePlatformAdmin(req, res))) return

    const { portalOrgId } = req.params
    const row = await portalBaseQuery().where('o.id', portalOrgId).where('o.parent_id', ROOT_ORG_ID).first()

    if (!row) {
      return res.status(404).json({ error: 'Portal not found', code: 'NOT_FOUND' })
    }

    res.status(200).json(rowToPortalDto(row))
  } catch (error: any) {
    console.error('[security] Error fetching portal:', error)
    res.status(500).json({ error: 'Failed to fetch portal' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /portals/:portalOrgId/suspend — org-level status flip (idempotent)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/portals/:portalOrgId/suspend', authenticateToken, async (req: any, res) => {
  try {
    if (!(await requirePlatformAdmin(req, res))) return

    const { portalOrgId } = req.params

    const org = await db('organizations').where('id', portalOrgId).first()
    if (!org) {
      return res.status(404).json({ error: 'Portal not found', code: 'NOT_FOUND' })
    }
    // The platform root is not a portal and can never be suspended — an
    // explicit 409, not folded into the generic "not a portal" 404 below,
    // per the frozen contract.
    if (org.id === ROOT_ORG_ID) {
      return res.status(409).json({ error: 'The platform root is not a portal', code: 'CONFLICT' })
    }

    const row = await portalBaseQuery().where('o.id', portalOrgId).where('o.parent_id', ROOT_ORG_ID).first()
    if (!row) {
      return res.status(404).json({ error: 'Portal not found', code: 'NOT_FOUND' })
    }

    // Idempotent: already-suspended is a no-op 200, not an error.
    if (row.status !== 'suspended' || row.is_active) {
      await db.transaction(async trx => {
        await trx('organizations').where('id', portalOrgId).update({ is_active: false, updated_at: new Date() })
        await trx('organization_portal_attributes')
          .where('organization_id', portalOrgId)
          .update({ status: 'suspended', updated_at: new Date() })
      })
    }

    const updated = await portalBaseQuery().where('o.id', portalOrgId).first()
    res.status(200).json(rowToPortalDto(updated))
  } catch (error: any) {
    console.error('[security] Error suspending portal:', error)
    res.status(500).json({ error: 'Failed to suspend portal' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /portals/:portalOrgId/resume — org-level status flip (idempotent)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/portals/:portalOrgId/resume', authenticateToken, async (req: any, res) => {
  try {
    if (!(await requirePlatformAdmin(req, res))) return

    const { portalOrgId } = req.params

    const row = await portalBaseQuery().where('o.id', portalOrgId).where('o.parent_id', ROOT_ORG_ID).first()
    if (!row) {
      return res.status(404).json({ error: 'Portal not found', code: 'NOT_FOUND' })
    }

    // Idempotent: already-active is a no-op 200, not an error.
    if (row.status !== 'active' || !row.is_active) {
      await db.transaction(async trx => {
        await trx('organizations').where('id', portalOrgId).update({ is_active: true, updated_at: new Date() })
        await trx('organization_portal_attributes')
          .where('organization_id', portalOrgId)
          .update({ status: 'active', updated_at: new Date() })
      })
    }

    const updated = await portalBaseQuery().where('o.id', portalOrgId).first()
    res.status(200).json(rowToPortalDto(updated))
  } catch (error: any) {
    console.error('[security] Error resuming portal:', error)
    res.status(500).json({ error: 'Failed to resume portal' })
  }
})

export default router
