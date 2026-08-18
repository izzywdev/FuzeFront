import express from 'express'
import rateLimit from 'express-rate-limit'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { mintId, toUuid } from '@izzywdev/fuzefront-identity'
import { authenticateToken, requireRole } from '../middleware/auth'
import {
  PermissionMiddleware,
  requireOwnership,
} from '../middleware/permissions'
import { db } from '../config/database'
import { Organization, OrganizationMembership } from '../types/shared'
import { reconcileOrganizationProvisioning } from '../services/organizationProvisioning'
import { defaultEventPublisher } from '../services/eventPublisher'
import { resolvePortalScopeDecision, applyPortalScope, normalizePortalId } from '../utils/scopeToPortal'
import { getRequestPortalScopingEnabled } from '../utils/identityFlag'

const router = express.Router()

// `settings`/`metadata` are jsonb columns. The `pg` driver already parses jsonb
// into JS objects on read, so calling JSON.parse() on them throws
// ("[object Object]" is not valid JSON) and 500s the route. Older code paths /
// other drivers (e.g. sqlite) may hand back a string instead, so accept both:
// pass objects through, parse strings, and fall back to {} on anything invalid.
function parseJsonColumn(value: unknown): Record<string, any> {
  if (value == null) return {}
  if (typeof value === 'object') return value as Record<string, any>
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
  return {}
}

// Input validation helpers
function validateOrganizationInput(data: any) {
  const errors: string[] = []

  if (
    !data.name ||
    typeof data.name !== 'string' ||
    data.name.trim().length === 0
  ) {
    errors.push('Name is required and must be a non-empty string')
  }

  if (data.name && data.name.length > 255) {
    errors.push('Name must be 255 characters or less')
  }

  if (
    !data.slug ||
    typeof data.slug !== 'string' ||
    data.slug.trim().length === 0
  ) {
    errors.push('Slug is required and must be a non-empty string')
  }

  if (data.slug && data.slug.length > 100) {
    errors.push('Slug must be 100 characters or less')
  }

  // Validate slug format (alphanumeric, hyphens, underscores only)
  if (data.slug && !/^[a-zA-Z0-9_-]+$/.test(data.slug)) {
    errors.push(
      'Slug can only contain letters, numbers, hyphens, and underscores'
    )
  }

  if (
    data.type &&
    !['platform', 'organization', 'personal'].includes(data.type)
  ) {
    errors.push('Type must be one of "platform", "organization", "personal"')
  }

  return errors
}

function sanitizeInput(data: any) {
  return {
    name: data.name?.trim(),
    slug: data.slug?.trim().toLowerCase(),
    type: data.type || 'organization',
    parent_id: data.parent_id?.trim() || null,
    settings:
      data.settings && typeof data.settings === 'object' ? data.settings : {},
    metadata:
      data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
  }
}

// POST /api/organizations - Create a new organization
router.post('/', authenticateToken, async (req: any, res) => {
  try {
    const input = sanitizeInput(req.body)
    const validationErrors = validateOrganizationInput(input)

    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors,
      })
    }

    // Check if slug already exists
    const existingOrg = await db('organizations')
      .where('slug', input.slug)
      .first()

    if (existingOrg) {
      return res.status(409).json({
        error: 'An organization with this slug already exists',
      })
    }

    // Validate parent organization if specified
    if (input.parent_id) {
      const parentOrg = await db('organizations')
        .where('id', input.parent_id)
        .where('is_active', true)
        .first()

      if (!parentOrg) {
        return res.status(400).json({
          error: 'Parent organization not found or inactive',
        })
      }

      // Check if user has permission to create sub-organizations
      const membership = await db('organization_memberships')
        .where('user_id', req.user.id)
        .where('organization_id', input.parent_id)
        .where('status', 'active')
        .whereIn('role', ['owner', 'admin'])
        .first()

      if (!membership) {
        return res.status(403).json({
          error:
            'Insufficient permissions to create sub-organization in parent organization',
        })
      }
    }

    const organizationId = toUuid(mintId('organization'))

    // Create organization in transaction
    await db.transaction(async trx => {
      // Insert organization
      await trx('organizations').insert({
        id: organizationId,
        name: input.name,
        slug: input.slug,
        parent_id: input.parent_id,
        owner_id: req.user.id,
        type: input.type,
        settings: JSON.stringify(input.settings),
        metadata: JSON.stringify(input.metadata),
        is_active: true,
      })

      // Create owner membership
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
    })

    // Fetch the created organization
    const newOrganization = await db('organizations')
      .where('id', organizationId)
      .first()

    const organization: Organization = {
      id: newOrganization.id,
      name: newOrganization.name,
      slug: newOrganization.slug,
      parent_id: newOrganization.parent_id,
      owner_id: newOrganization.owner_id,
      type: newOrganization.type,
      settings: parseJsonColumn(newOrganization.settings),
      metadata: parseJsonColumn(newOrganization.metadata),
      is_active: newOrganization.is_active,
      created_at: newOrganization.created_at,
      updated_at: newOrganization.updated_at,
    }

    // Provision Permit wiring via the idempotent, resumable reconciler instead
    // of a fire-and-forget Promise.all. We await it so the per-step state is
    // recorded, but a Permit outage must not 500 the create — the org is created
    // in `pending` and will self-heal on the user's next login (or via the
    // internal provision endpoint), so we swallow reconciler errors here.
    try {
      await reconcileOrganizationProvisioning(organizationId)
    } catch (error) {
      console.error(
        `Provisioning reconcile failed for org ${organizationId} (will self-heal):`,
        error
      )
    }

    res.status(201).json(organization)
  } catch (error: any) {
    console.error('Error creating organization:', error)

    // Check for unique constraint violations
    if (error.code === '23505' || error.message?.includes('duplicate key')) {
      return res.status(409).json({
        error: 'An organization with this slug already exists',
      })
    }

    res.status(500).json({ error: 'Failed to create organization' })
  }
})

// GET /api/organizations - List organizations with filtering and pagination
router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      type,
      parent_id,
      is_active = true,
      search,
      sort = 'name',
      order = 'asc',
    } = req.query

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)))
    const offset = (pageNum - 1) * limitNum

    // Validate sort parameters
    const validSortFields = ['name', 'slug', 'type', 'created_at', 'updated_at']
    const sortField = validSortFields.includes(sort) ? sort : 'name'
    const sortOrder = ['asc', 'desc'].includes(order) ? order : 'asc'

    // Build query
    let query = db('organizations')
      .select('organizations.*')
      .joinRaw(
        'LEFT JOIN organization_memberships ON organizations.id = organization_memberships.organization_id AND organization_memberships.user_id = ? AND organization_memberships.status = ?',
        [req.user.id, 'active']
      )
      .where(function () {
        // User can see organizations they are members of, or public organizations
        this.whereNotNull('organization_memberships.id').orWhere(
          'organizations.type',
          'platform'
        )
      })

    // Apply filters
    if (type) {
      query = query.where('organizations.type', type)
    }

    if (parent_id !== undefined) {
      if (parent_id === '') {
        query = query.whereNull('organizations.parent_id')
      } else {
        query = query.where('organizations.parent_id', parent_id)
      }
    }

    // `is_active` defaults to the boolean `true` (when no query param is sent),
    // but arrives as a string when it IS sent. Comparing `true === 'true'`
    // yields false, which previously filtered to is_active=false and hid every
    // active org (including the user's personal org) — leaving the frontend
    // WorkspaceProvisioningGate stuck on "Creating your workspace…". Coerce both
    // shapes: treat boolean true and the string 'true' as active.
    if (is_active !== undefined) {
      const wantActive = is_active === true || is_active === 'true'
      query = query.where('organizations.is_active', wantActive)
    }

    if (search) {
      query = query.where(function () {
        this.whereILike('organizations.name', `%${search}%`).orWhereILike(
          'organizations.slug',
          `%${search}%`
        )
      })
    }

    // Get total count. clearSelect() drops the `organizations.*` projection so the
    // count query is a plain count(*) (otherwise Postgres requires a GROUP BY).
    const countQuery = query.clone().clearSelect().count('* as total').first()
    const totalResult = await countQuery
    const total = parseInt((totalResult?.total as string) || '0')

    // Apply sorting and pagination
    const organizations = await query
      .orderBy(`organizations.${sortField}`, sortOrder)
      .limit(limitNum)
      .offset(offset)

    // Transform results
    const transformedOrganizations: Organization[] = organizations.map(org => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      parent_id: org.parent_id,
      owner_id: org.owner_id,
      type: org.type,
      settings: parseJsonColumn(org.settings),
      metadata: parseJsonColumn(org.metadata),
      is_active: org.is_active,
      created_at: org.created_at,
      updated_at: org.updated_at,
    }))

    res.json({
      organizations: transformedOrganizations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasNext: pageNum * limitNum < total,
        hasPrev: pageNum > 1,
      },
    })
  } catch (error: any) {
    console.error('Error fetching organizations:', error)
    res.status(500).json({ error: 'Failed to fetch organizations' })
  }
})

// GET /api/organizations/:id - Get organization by ID
router.get(
  '/:id',
  authenticateToken,
  PermissionMiddleware.canReadOrganization,
  async (req: any, res) => {
    try {
      const { id } = req.params

      // Check if user has access to this organization
      const organization = await db('organizations')
        .select('organizations.*')
        .joinRaw(
          'LEFT JOIN organization_memberships ON organizations.id = organization_memberships.organization_id AND organization_memberships.user_id = ? AND organization_memberships.status = ?',
          [req.user.id, 'active']
        )
        .where('organizations.id', id)
        .where(function () {
          // User can see organizations they are members of, or public organizations
          this.whereNotNull('organization_memberships.id').orWhere(
            'organizations.type',
            'platform'
          )
        })
        .first()

      if (!organization) {
        return res
          .status(404)
          .json({ error: 'Organization not found or access denied' })
      }

      const result: Organization = {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        parent_id: organization.parent_id,
        owner_id: organization.owner_id,
        type: organization.type,
        settings: parseJsonColumn(organization.settings),
        metadata: parseJsonColumn(organization.metadata),
        is_active: organization.is_active,
        created_at: organization.created_at,
        updated_at: organization.updated_at,
      }

      res.json(result)
    } catch (error: any) {
      console.error('Error fetching organization:', error)
      res.status(500).json({ error: 'Failed to fetch organization' })
    }
  }
)

// PUT /api/organizations/:id - Update organization
router.put(
  '/:id',
  authenticateToken,
  PermissionMiddleware.canUpdateOrganization,
  async (req: any, res) => {
    try {
      const { id } = req.params
      const input = sanitizeInput(req.body)

      // Check if user has permission to update this organization
      const membership = await db('organization_memberships')
        .where('user_id', req.user.id)
        .where('organization_id', id)
        .where('status', 'active')
        .whereIn('role', ['owner', 'admin'])
        .first()

      if (!membership) {
        return res.status(403).json({
          error: 'Insufficient permissions to update this organization',
        })
      }

      // Validate input
      const validationErrors = validateOrganizationInput(input)
      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validationErrors,
        })
      }

      // Check if slug conflicts with another organization
      if (input.slug) {
        const existingOrg = await db('organizations')
          .where('slug', input.slug)
          .where('id', '!=', id)
          .first()

        if (existingOrg) {
          return res.status(409).json({
            error: 'An organization with this slug already exists',
          })
        }
      }

      // Update organization
      await db('organizations')
        .where('id', id)
        .update({
          name: input.name,
          slug: input.slug,
          settings: JSON.stringify(input.settings),
          metadata: JSON.stringify(input.metadata),
          updated_at: new Date(),
        })

      // Fetch updated organization
      const updatedOrganization = await db('organizations')
        .where('id', id)
        .first()

      const result: Organization = {
        id: updatedOrganization.id,
        name: updatedOrganization.name,
        slug: updatedOrganization.slug,
        parent_id: updatedOrganization.parent_id,
        owner_id: updatedOrganization.owner_id,
        type: updatedOrganization.type,
        settings: parseJsonColumn(updatedOrganization.settings),
        metadata: parseJsonColumn(updatedOrganization.metadata),
        is_active: updatedOrganization.is_active,
        created_at: updatedOrganization.created_at,
        updated_at: updatedOrganization.updated_at,
      }

      res.json(result)
    } catch (error: any) {
      console.error('Error updating organization:', error)

      if (error.code === '23505' || error.message?.includes('duplicate key')) {
        return res.status(409).json({
          error: 'An organization with this slug already exists',
        })
      }

      res.status(500).json({ error: 'Failed to update organization' })
    }
  }
)

// DELETE /api/organizations/:id - Deactivate organization
router.delete(
  '/:id',
  authenticateToken,
  PermissionMiddleware.canDeleteOrganization,
  async (req: any, res) => {
    try {
      const { id } = req.params

      // Check if user is owner of this organization
      const membership = await db('organization_memberships')
        .where('user_id', req.user.id)
        .where('organization_id', id)
        .where('status', 'active')
        .where('role', 'owner')
        .first()

      if (!membership) {
        return res.status(403).json({
          error: 'Only organization owners can deactivate organizations',
        })
      }

      // Check for child organizations
      const childOrganizations = await db('organizations')
        .where('parent_id', id)
        .where('is_active', true)
        .count('* as count')
        .first()

      if (parseInt((childOrganizations?.count as string) || '0') > 0) {
        return res.status(400).json({
          error:
            'Cannot deactivate organization with active child organizations',
        })
      }

      // Deactivate organization (soft delete)
      await db('organizations').where('id', id).update({
        is_active: false,
        updated_at: new Date(),
      })

      res.json({ message: 'Organization deactivated successfully' })
    } catch (error: any) {
      console.error('Error deactivating organization:', error)
      res.status(500).json({ error: 'Failed to deactivate organization' })
    }
  }
)

// GET /api/organizations/:id/members - list an organization's member users
// (FF-EPIC-11-S2/S6) — a membership-listing READ path, routed through the
// SAME central `scopeToPortal` helper as routes/users.ts. An org belongs to at
// most one portal, so this is defense-in-depth against a member row whose
// user's `home_portal_id` doesn't (or no longer) match the org's own portal —
// never a raw, unscoped `users` join.
const DEFAULT_MEMBERS_LIMIT = 50
const MAX_MEMBERS_LIMIT = 200

function encodeMemberCursor(row: { joined_at: any; membership_id: string }): string {
  const joinedAt = row.joined_at ? new Date(row.joined_at).toISOString() : ''
  return Buffer.from(`${joinedAt}|${row.membership_id}`, 'utf8').toString('base64url')
}

function decodeMemberCursor(cursor: string): { joinedAt: string; membershipId: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const idx = decoded.indexOf('|')
    if (idx < 0) return null
    return { joinedAt: decoded.slice(0, idx), membershipId: decoded.slice(idx + 1) }
  } catch {
    return null
  }
}

// FF-EPIC-11-S2 — rate-limit the members directory read (CodeQL
// js/missing-rate-limiting). Same config as adminPortals.ts's adminRateLimiter.
const membersRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

router.get(
  '/:id/members',
  membersRateLimiter,
  authenticateToken,
  PermissionMiddleware.canReadOrganization,
  async (req: any, res) => {
    try {
      const { id } = req.params
      const rawLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : NaN
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, MAX_MEMBERS_LIMIT)
          : DEFAULT_MEMBERS_LIMIT
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined

      // Resolve the decision BEFORE querying so a 'denied' (missing/malformed
      // portal context) short-circuits without an unscoped fallback query.
      const decision = await resolvePortalScopeDecision(req)
      if (decision.mode === 'denied') {
        return res.status(403).json({
          error: 'PORTAL_CONTEXT_REQUIRED',
          message: 'A valid portal context is required to list members.',
        })
      }

      let query = db('organization_memberships as om')
        .join('users as u', 'u.id', 'om.user_id')
        .select(
          'om.id as membership_id',
          'om.role',
          'om.status',
          'om.joined_at',
          'u.id as user_id',
          'u.email',
          'u.first_name',
          'u.last_name',
          'u.home_portal_id'
        )
        .where('om.organization_id', id)
        .where('om.status', 'active')

      // Portal-scope the JOINED users rows (column lives on the aliased `u`).
      query = applyPortalScope(query, decision, 'u.home_portal_id')

      if (cursor) {
        const c = decodeMemberCursor(cursor)
        if (!c) {
          return res.status(400).json({ error: 'INVALID_CURSOR', message: 'Malformed cursor.' })
        }
        query = query.andWhere(function (this: any) {
          this.where('om.joined_at', '>', c.joinedAt).orWhere(function (this: any) {
            this.where('om.joined_at', '=', c.joinedAt).andWhere('om.id', '>', c.membershipId)
          })
        })
      }

      const rows = await query
        .orderBy('om.joined_at', 'asc')
        .orderBy('om.id', 'asc')
        .limit(limit + 1)

      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const nextCursor = hasMore ? encodeMemberCursor(page[page.length - 1]) : null

      res.json({
        items: page.map((row: any) => ({
          membershipId: row.membership_id,
          role: row.role,
          status: row.status,
          joinedAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
          user: {
            id: row.user_id,
            email: row.email,
            firstName: row.first_name ?? null,
            lastName: row.last_name ?? null,
            homePortalId: row.home_portal_id ?? null,
          },
        })),
        page: { nextCursor, hasMore },
      })
    } catch (error: any) {
      console.error('Error listing organization members:', error)
      res.status(500).json({ error: 'Failed to list organization members' })
    }
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Invitation sub-routes: /api/organizations/:id/invitations (FF-EPIC-11-S3)
//
// Ported from backend/security/src/routes/organizations.ts (the reference
// contract), adapted to this monolith's conventions: its `db`, `authenticateToken`
// + Permit `PermissionMiddleware.canManageOrganization` (not the security
// service's DB-membership-based `requireOrgAdminOrOwner`), cursor pagination
// per governance/pagination-standard.md (the reference used no pagination at
// all), and rate limiting (CodeQL js/missing-rate-limiting).
//
// PORTAL-AWARE INVITE-BY-EMAIL (the core of S3), gated by the SAME
// `fuzefront.identity.portal-scoped-users` flag as S2, via the shared
// `getRequestPortalScopingEnabled` reader (utils/identityFlag.ts) — reused,
// not re-implemented. Flag OFF -> BYTE-IDENTICAL pre-epic behavior (no
// `portal_id` captured on the invitation row, no cross-portal email check).
//
// *** THE EXPLICIT CROSS-PORTAL-EMAIL POLICY (AC2) ***
// This epic keeps email GLOBALLY unique (hard per-tenant email namespacing is
// explicitly out of scope), so a second account can never be created for an
// email already homed to a DIFFERENT portal. The invite is therefore
// REJECTED outright (409 EMAIL_IN_OTHER_PORTAL) rather than silently
// attaching membership on the foreign account. This decision is enforced at
// EVERY call site that could grant membership on that email's account:
//   1. HERE, at invite CREATE time (this file) — the primary enforcement
//      point, before an email is ever sent.
//   2. AGAIN, defense-in-depth, at ACCEPT time (routes/invitations.ts) — in
//      case the account's home portal changed between invite and accept.
// Never make an exception to this rule at a third call site without updating
// both of the above.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_INVITE_ROLES = ['admin', 'member', 'viewer']

function isValidInviteEmail(email: string): boolean {
  // Linear, non-backtracking validation (CodeQL js/redos): the regex
  // /^[^\s@]+@[^\s@]+\.[^\s@]+$/ is polynomial on the attacker-controlled
  // invite email — `.` is itself in `[^\s@]`, so the two groups around the
  // literal `\.` overlap and a near-match backtracks superlinearly. Structural
  // indexOf/slice checks preserve the exact accept/reject semantics with no
  // backtracking (matches adminPortals.ts's linear validEmail).
  if (typeof email !== 'string' || email.length === 0 || email.length > 254) return false
  if (/\s/.test(email)) return false // single-char class, linear
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@')) return false // exactly one '@', not leading
  const domain = email.slice(at + 1)
  const dot = domain.indexOf('.')
  return dot > 0 && dot < domain.length - 1 // '.' present, char on each side
}

// FF-EPIC-11-S3 — rate-limit every new invitation route (CodeQL
// js/missing-rate-limiting). Same config as adminPortals.ts's adminRateLimiter
// / this file's own membersRateLimiter above.
const invitationsRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

const DEFAULT_INVITATIONS_LIMIT = 50
const MAX_INVITATIONS_LIMIT = 200

function encodeInvitationCursor(row: { created_at: any; id: string }): string {
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : ''
  return Buffer.from(`${createdAt}|${row.id}`, 'utf8').toString('base64url')
}

function decodeInvitationCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const idx = decoded.indexOf('|')
    if (idx < 0) return null
    return { createdAt: decoded.slice(0, idx), id: decoded.slice(idx + 1) }
  } catch {
    return null
  }
}

function rowToInvitationSummary(row: any) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    portalId: row.portal_id ?? null,
  }
}

/**
 * @swagger
 * /api/organizations/{id}/invitations:
 *   get:
 *     summary: List an organization's pending invitations (paginated, admin/owner only)
 *     tags: [Organizations, Invitations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated invitations envelope
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items: { type: object }
 *                 page:
 *                   type: object
 *                   properties:
 *                     nextCursor: { type: string, nullable: true }
 *                     hasMore: { type: boolean }
 *       403:
 *         description: Caller does not have manage authority on this organization
 *   post:
 *     summary: Invite a user to an organization by email (portal-aware — see FF-EPIC-11-S3)
 *     tags: [Organizations, Invitations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *               role: { type: string, enum: [admin, member, viewer], default: member }
 *     responses:
 *       201:
 *         description: Invitation created
 *       400:
 *         description: Invalid email/role
 *       403:
 *         description: Caller does not have manage authority on this organization
 *       409:
 *         description: A pending invitation already exists, OR (portal-scoped) the email is homed to a different portal (EMAIL_IN_OTHER_PORTAL)
 */
router.get(
  '/:id/invitations',
  invitationsRateLimiter,
  authenticateToken,
  PermissionMiddleware.canManageOrganization,
  async (req: any, res) => {
    try {
      const { id } = req.params
      const rawLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : NaN
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, MAX_INVITATIONS_LIMIT)
          : DEFAULT_INVITATIONS_LIMIT
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined

      let query = db('organization_invitations')
        .where('organization_id', id)
        .where('status', 'pending')

      if (cursor) {
        const c = decodeInvitationCursor(cursor)
        if (!c) {
          return res.status(400).json({ error: 'INVALID_CURSOR', message: 'Malformed cursor.' })
        }
        // `created_at` is DB-generated (`defaultTo(knex.fn.now())`, migration
        // 009) and carries SUB-millisecond precision in Postgres, but the
        // cursor is a JS `Date`-derived ISO string (millisecond precision
        // only — `Date` cannot hold more). Comparing the raw column against
        // the millisecond-truncated cursor value directly would make a
        // boundary row satisfy `created_at > cursor` against ITSELF (its true
        // stored value is a few microseconds past its own truncated
        // representation), duplicating it across the page boundary.
        // `date_trunc('milliseconds', ...)` on BOTH sides of the comparison
        // matches the precision the cursor can actually represent, so a
        // boundary row's truncated value compares exactly equal to (never
        // greater than) its own cursor. (`organization_memberships.joined_at`
        // — this file's other keyset cursor, above — sidesteps this because
        // every write sets it from a JS `new Date()`, already ms-precision at
        // insert time; this column is DB-generated, so it needs the explicit
        // truncation instead.)
        query = query.andWhere(function (this: any) {
          this.whereRaw("date_trunc('milliseconds', created_at) > ?::timestamptz", [c.createdAt]).orWhere(
            function (this: any) {
              this.whereRaw("date_trunc('milliseconds', created_at) = ?::timestamptz", [
                c.createdAt,
              ]).andWhere('id', '>', c.id)
            }
          )
        })
      }

      const rows = await query
        .orderByRaw("date_trunc('milliseconds', created_at) asc")
        .orderBy('id', 'asc')
        .limit(limit + 1)

      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const nextCursor = hasMore ? encodeInvitationCursor(page[page.length - 1]) : null

      res.json({
        items: page.map(rowToInvitationSummary),
        page: { nextCursor, hasMore },
      })
    } catch (error: any) {
      console.error('Error listing invitations:', error)
      res.status(500).json({ error: 'Failed to list invitations' })
    }
  }
)

router.post(
  '/:id/invitations',
  invitationsRateLimiter,
  authenticateToken,
  PermissionMiddleware.canManageOrganization,
  async (req: any, res) => {
    try {
      const { id } = req.params
      const { email, role = 'member' } = req.body

      if (!email || typeof email !== 'string' || !isValidInviteEmail(email.trim())) {
        return res.status(400).json({ error: 'A valid email address is required' })
      }
      if (!ALLOWED_INVITE_ROLES.includes(role)) {
        return res.status(400).json({
          error: `Invalid role. Allowed values: ${ALLOWED_INVITE_ROLES.join(', ')}`,
        })
      }

      const normalizedEmail = email.toLowerCase().trim()

      // FF-EPIC-11-S3 AC1/AC2/AC3 — portal-aware invite, gated by the identity
      // flag. `invitationPortalId` is what the invitation row is bound to
      // (migration 020) and what routes/invitations.ts's accept flow (AC4)
      // checks the accepting session's portal context against.
      const portalScopingEnabled = await getRequestPortalScopingEnabled(req)
      let invitationPortalId: string | null = null

      if (portalScopingEnabled) {
        invitationPortalId = normalizePortalId(req.user.portalId)

        // AC2 — a single-row existence/portal check for invite-authorization
        // purposes ONLY. This is deliberately NOT routed through
        // `scopeToPortal`'s read-scoping: that guard exists to stop an
        // unprivileged caller from LISTING another portal's user directory.
        // This route already required 'manage' authority on THIS org (via
        // PermissionMiddleware.canManageOrganization above) before reaching
        // here, and this query returns no row data to the caller at all —
        // only a same-portal/different-portal DECISION.
        const existingUser = await db('users')
          .where('email', normalizedEmail)
          .select('id', 'home_portal_id')
          .first()

        if (existingUser) {
          const existingUserPortalId = normalizePortalId(existingUser.home_portal_id)
          if (existingUserPortalId !== invitationPortalId) {
            return res.status(409).json({
              error: 'EMAIL_IN_OTHER_PORTAL',
              message:
                'This email is already associated with an account homed to a different portal.',
            })
          }
        }
        // else: brand-new email, no conflict — AC1 (the future account is
        // homed to invitationPortalId on accept, see routes/invitations.ts).
      }

      const existing = await db('organization_invitations')
        .where('organization_id', id)
        .where('email', normalizedEmail)
        .where('status', 'pending')
        .first()

      if (existing) {
        return res.status(409).json({ error: 'A pending invitation already exists for this email' })
      }

      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const invitationId = toUuid(mintId('invitation'))
      const correlationId = uuidv4()

      await db('organization_invitations').insert({
        id: invitationId,
        organization_id: id,
        email: normalizedEmail,
        role,
        token,
        expires_at: expiresAt,
        status: 'pending',
        invited_by: req.user.id,
        portal_id: invitationPortalId,
      })

      // Fire email event (non-blocking — swallow errors so invite still succeeds)
      try {
        const org = await db('organizations').where('id', id).first()
        const inviter = await db('users').where('id', req.user.id).first()
        const inviterName = inviter
          ? (`${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email)
          : req.user.email
        const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${token}`

        await defaultEventPublisher.publishNotifyEmailRequested(
          {
            to: normalizedEmail,
            template: 'org-invite',
            vars: { orgName: org?.name ?? '', inviterName, role, acceptUrl },
            orgId: id,
            correlationId,
          },
          correlationId
        )
      } catch (emailErr) {
        console.error('Failed to publish invite email event (non-fatal):', emailErr)
      }

      res.status(201).json({
        invitation: {
          id: invitationId,
          organizationId: id,
          email: normalizedEmail,
          role,
          expiresAt,
          status: 'pending',
          portalId: invitationPortalId,
        },
      })
    } catch (error: any) {
      console.error('Error creating invitation:', error)
      res.status(500).json({ error: 'Failed to create invitation' })
    }
  }
)

// POST /api/organizations/:id/invitations/:invitationId/resend — resend email
router.post(
  '/:id/invitations/:invitationId/resend',
  invitationsRateLimiter,
  authenticateToken,
  PermissionMiddleware.canManageOrganization,
  async (req: any, res) => {
    try {
      const { id, invitationId } = req.params

      const invitation = await db('organization_invitations')
        .where('id', invitationId)
        .where('organization_id', id)
        .first()

      if (!invitation) {
        return res.status(404).json({ error: 'Invitation not found' })
      }
      if (invitation.status !== 'pending') {
        return res.status(409).json({ error: `Cannot resend a ${invitation.status} invitation` })
      }

      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await db('organization_invitations')
        .where('id', invitationId)
        .update({ expires_at: newExpiresAt })

      try {
        const org = await db('organizations').where('id', id).first()
        const inviter = await db('users').where('id', req.user.id).first()
        const inviterName = inviter
          ? (`${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email)
          : req.user.email
        const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${invitation.token}`
        const correlationId = uuidv4()

        await defaultEventPublisher.publishNotifyEmailRequested(
          {
            to: invitation.email,
            template: 'org-invite',
            vars: { orgName: org?.name ?? '', inviterName, role: invitation.role, acceptUrl },
            orgId: id,
            correlationId,
          },
          correlationId
        )
      } catch (emailErr) {
        console.error('Failed to publish resend email event (non-fatal):', emailErr)
      }

      res.json({ message: 'Invitation resent successfully' })
    } catch (error: any) {
      console.error('Error resending invitation:', error)
      res.status(500).json({ error: 'Failed to resend invitation' })
    }
  }
)

// DELETE /api/organizations/:id/invitations/:invitationId — revoke
router.delete(
  '/:id/invitations/:invitationId',
  invitationsRateLimiter,
  authenticateToken,
  PermissionMiddleware.canManageOrganization,
  async (req: any, res) => {
    try {
      const { id, invitationId } = req.params

      const invitation = await db('organization_invitations')
        .where('id', invitationId)
        .where('organization_id', id)
        .first()

      if (!invitation) {
        return res.status(404).json({ error: 'Invitation not found' })
      }

      await db('organization_invitations')
        .where('id', invitationId)
        .update({ status: 'revoked' })

      res.json({ message: 'Invitation revoked successfully' })
    } catch (error: any) {
      console.error('Error revoking invitation:', error)
      res.status(500).json({ error: 'Failed to revoke invitation' })
    }
  }
)

export default router
