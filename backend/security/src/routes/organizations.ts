import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import { authenticateToken, requireRole } from '../middleware/auth'
import {
  PermissionMiddleware,
  requireOwnership,
} from '../middleware/permissions'
import { db } from '../config/database'
import { Organization, OrganizationMembership } from '../types/shared'
import { reconcileOrganizationProvisioning } from '../services/organizationProvisioning'
import { defaultEventPublisher } from '../services/eventPublisher'
import { assignOrganizationRole } from '../utils/permit/role-assignment'

const router = express.Router()

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

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Helper: check if the requesting user is owner or admin of an org
async function requireOrgAdminOrOwner(userId: string, orgId: string): Promise<boolean> {
  const membership = await db('organization_memberships')
    .where('user_id', userId)
    .where('organization_id', orgId)
    .where('status', 'active')
    .whereIn('role', ['owner', 'admin'])
    .first()
  return !!membership
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

    const organizationId = uuidv4()

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
        id: uuidv4(),
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
      settings: JSON.parse(newOrganization.settings || '{}'),
      metadata: JSON.parse(newOrganization.metadata || '{}'),
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
      .leftJoin('organization_memberships', function () {
        this.on(
          'organizations.id',
          '=',
          'organization_memberships.organization_id'
        )
          .andOn(
            'organization_memberships.user_id',
            '=',
            db.raw('?', [req.user.id])
          )
          .andOn(
            'organization_memberships.status',
            '=',
            db.raw('?', ['active'])
          )
      })
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

    if (is_active !== undefined) {
      query = query.where('organizations.is_active', is_active === 'true')
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
      settings: JSON.parse(org.settings || '{}'),
      metadata: JSON.parse(org.metadata || '{}'),
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
        .leftJoin('organization_memberships', function () {
          this.on(
            'organizations.id',
            '=',
            'organization_memberships.organization_id'
          )
            .andOn(
              'organization_memberships.user_id',
              '=',
              db.raw('?', [req.user.id])
            )
            .andOn(
              'organization_memberships.status',
              '=',
              db.raw('?', ['active'])
            )
        })
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
        settings: JSON.parse(organization.settings || '{}'),
        metadata: JSON.parse(organization.metadata || '{}'),
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
        settings: JSON.parse(updatedOrganization.settings || '{}'),
        metadata: JSON.parse(updatedOrganization.metadata || '{}'),
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

// ─────────────────────────────────────────────────────────────────────────────
// Invitation sub-routes: /api/organizations/:id/invitations
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/organizations/:id/invitations — list pending invitations
router.get('/:id/invitations', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params

    const isAdmin = await requireOrgAdminOrOwner(req.user.id, id)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    const invitations = await db('organization_invitations')
      .where('organization_id', id)
      .whereIn('status', ['pending'])
      .orderBy('created_at', 'desc')

    res.json({ invitations })
  } catch (error: any) {
    console.error('Error listing invitations:', error)
    res.status(500).json({ error: 'Failed to list invitations' })
  }
})

// POST /api/organizations/:id/invitations — create invitation
router.post('/:id/invitations', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params
    const { email, role = 'member' } = req.body

    // Validate email
    if (!email || typeof email !== 'string' || !isValidEmail(email.trim())) {
      return res.status(400).json({ error: 'A valid email address is required' })
    }

    // Validate role — owner cannot be invited; only admin/member/viewer are allowed
    const ALLOWED_INVITE_ROLES = ['admin', 'member', 'viewer']
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Allowed values: ${ALLOWED_INVITE_ROLES.join(', ')}` })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Permission check
    const isAdmin = await requireOrgAdminOrOwner(req.user.id, id)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    // Check for existing pending invitation
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
    const invitationId = uuidv4()
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
      },
    })
  } catch (error: any) {
    console.error('Error creating invitation:', error)
    res.status(500).json({ error: 'Failed to create invitation' })
  }
})

// POST /api/organizations/:id/invitations/bulk — bulk create (max 50 emails)
// NOTE: must be registered BEFORE /:id/invitations/:invitationId routes to avoid
// "bulk" being treated as an invitationId.
router.post('/:id/invitations/bulk', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params
    const { emails, role = 'member' } = req.body

    if (!Array.isArray(emails)) {
      return res.status(400).json({ error: 'emails must be an array' })
    }
    if (emails.length > 50) {
      return res.status(400).json({ error: 'Cannot exceed 50 emails in a single bulk invite' })
    }

    // Validate role — owner cannot be invited; only admin/member/viewer are allowed
    const ALLOWED_INVITE_ROLES = ['admin', 'member', 'viewer']
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Allowed values: ${ALLOWED_INVITE_ROLES.join(', ')}` })
    }

    const isAdmin = await requireOrgAdminOrOwner(req.user.id, id)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    const org = await db('organizations').where('id', id).first()
    const inviter = await db('users').where('id', req.user.id).first()
    const inviterName = inviter
      ? (`${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email)
      : req.user.email

    const results: Array<{ email: string; status: string; error?: string }> = []

    for (const rawEmail of emails) {
      if (typeof rawEmail !== 'string' || !isValidEmail(rawEmail.trim())) {
        results.push({ email: rawEmail, status: 'skipped', error: 'Invalid email format' })
        continue
      }
      const normalizedEmail = rawEmail.toLowerCase().trim()

      try {
        const existing = await db('organization_invitations')
          .where('organization_id', id)
          .where('email', normalizedEmail)
          .where('status', 'pending')
          .first()

        if (existing) {
          results.push({ email: normalizedEmail, status: 'skipped', error: 'Pending invitation already exists' })
          continue
        }

        const token = crypto.randomBytes(32).toString('hex')
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        const invitationId = uuidv4()
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
        })

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
        ).catch(err => console.error('Email event failed (non-fatal):', err))

        results.push({ email: normalizedEmail, status: 'invited' })
      } catch (err) {
        results.push({ email: normalizedEmail, status: 'error', error: 'Internal error' })
      }
    }

    res.status(201).json({ results })
  } catch (error: any) {
    console.error('Error bulk inviting:', error)
    res.status(500).json({ error: 'Failed to process bulk invitations' })
  }
})

// POST /api/organizations/:id/invitations/:invitationId/resend — resend email
router.post('/:id/invitations/:invitationId/resend', authenticateToken, async (req: any, res) => {
  try {
    const { id, invitationId } = req.params

    const isAdmin = await requireOrgAdminOrOwner(req.user.id, id)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

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

    // Extend expiry
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
})

// DELETE /api/organizations/:id/invitations/:invitationId — revoke
router.delete('/:id/invitations/:invitationId', authenticateToken, async (req: any, res) => {
  try {
    const { id, invitationId } = req.params

    const isAdmin = await requireOrgAdminOrOwner(req.user.id, id)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

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
})

// ─────────────────────────────────────────────────────────────────────────────
// Members sub-routes: /api/organizations/:id/members
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/organizations/:id/members — list members (any active member may view)
router.get('/:id/members', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params

    // Any active member (any role) may list members
    const callerMembership = await db('organization_memberships')
      .where('user_id', req.user.id)
      .where('organization_id', id)
      .where('status', 'active')
      .first()

    if (!callerMembership) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    const rows = await db('organization_memberships')
      .select(
        'organization_memberships.id',
        'organization_memberships.role',
        'organization_memberships.status',
        'organization_memberships.joined_at',
        'users.id as user_id',
        'users.email as user_email',
        'users.first_name',
        'users.last_name'
      )
      .join('users', 'users.id', 'organization_memberships.user_id')
      .where('organization_memberships.organization_id', id)
      .where('organization_memberships.status', 'active')
      .orderBy('organization_memberships.joined_at', 'asc')

    const members = rows.map((row: any) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      user: {
        id: row.user_id,
        email: row.user_email,
        firstName: row.first_name,
        lastName: row.last_name,
      },
      joined_at: row.joined_at,
      invited_at: null,
    }))

    res.json(members)
  } catch (error: any) {
    console.error('Error listing members:', error)
    res.status(500).json({ error: 'Failed to list members' })
  }
})

// POST /api/organizations/:id/members — invite a single member (legacy path)
// Creates a pending invitation row, identical to POST /:id/invitations.
router.post('/:id/members', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params
    const { email, role = 'member' } = req.body

    // Validate email
    if (!email || typeof email !== 'string' || !isValidEmail(email.trim())) {
      return res.status(400).json({ error: 'A valid email address is required' })
    }

    // Validate role — owner cannot be invited
    const ALLOWED_INVITE_ROLES = ['admin', 'member', 'viewer']
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Allowed values: ${ALLOWED_INVITE_ROLES.join(', ')}` })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Permission check — admin or owner only
    const isAdmin = await requireOrgAdminOrOwner(req.user.id, id)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    // Dedupe check
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
    const invitationId = uuidv4()
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
    })

    // Fire email event (non-blocking)
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
      },
    })
  } catch (error: any) {
    console.error('Error creating member invitation:', error)
    res.status(500).json({ error: 'Failed to create invitation' })
  }
})

// PUT /api/organizations/:id/members/:memberId — change a member's role
router.put('/:id/members/:memberId', authenticateToken, async (req: any, res) => {
  try {
    const { id, memberId } = req.params
    const { role } = req.body

    // Validate role
    const ALLOWED_ROLES = ['admin', 'member', 'viewer']
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Allowed values: ${ALLOWED_ROLES.join(', ')}` })
    }

    // Permission check
    const isAdmin = await requireOrgAdminOrOwner(req.user.id, id)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    // Fetch target membership
    const membership = await db('organization_memberships')
      .where('id', memberId)
      .where('organization_id', id)
      .first()

    if (!membership) {
      return res.status(404).json({ error: 'Member not found' })
    }

    // Protect owner memberships
    if (membership.role === 'owner') {
      return res.status(403).json({ error: 'Cannot change the role of an owner' })
    }

    await db('organization_memberships')
      .where('id', memberId)
      .update({ role })

    const updated = await db('organization_memberships')
      .where('id', memberId)
      .first()

    // Assign Permit role — non-blocking
    try {
      await assignOrganizationRole(
        membership.user_id,
        id,
        role as 'admin' | 'member' | 'viewer'
      )
    } catch (permitErr) {
      console.error(`Permit role update failed for membership ${memberId} (non-fatal):`, permitErr)
    }

    res.json(updated)
  } catch (error: any) {
    console.error('Error updating member role:', error)
    res.status(500).json({ error: 'Failed to update member role' })
  }
})

// DELETE /api/organizations/:id/members/:memberId — remove a member
router.delete('/:id/members/:memberId', authenticateToken, async (req: any, res) => {
  try {
    const { id, memberId } = req.params

    // Permission check
    const isAdmin = await requireOrgAdminOrOwner(req.user.id, id)
    if (!isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    // Fetch target membership
    const membership = await db('organization_memberships')
      .where('id', memberId)
      .where('organization_id', id)
      .first()

    if (!membership) {
      return res.status(404).json({ error: 'Member not found' })
    }

    // Protect owner memberships
    if (membership.role === 'owner') {
      return res.status(403).json({ error: 'Cannot remove the organization owner' })
    }

    await db('organization_memberships')
      .where('id', memberId)
      .delete()

    res.json({ message: 'Member removed' })
  } catch (error: any) {
    console.error('Error removing member:', error)
    res.status(500).json({ error: 'Failed to remove member' })
  }
})

export default router

