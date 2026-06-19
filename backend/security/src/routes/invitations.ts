/**
 * Public token-based invitation routes.
 * GET  /api/invitations/:token         — resolve (no auth required)
 * POST /api/invitations/:token/accept  — accept (auth optional)
 */
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { assignOrganizationRole } from '../utils/permit/role-assignment'

const router = express.Router()

// GET /api/invitations/:token — public, no auth
router.get('/:token', async (req: any, res) => {
  try {
    const { token } = req.params

    const invitation = await db('organization_invitations')
      .where('token', token)
      .first()

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    // Expired by status or by time
    if (invitation.status !== 'pending' || new Date(invitation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invitation has expired or been revoked' })
    }

    const organization = await db('organizations')
      .where('id', invitation.organization_id)
      .first()

    res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expires_at: invitation.expires_at,
        status: invitation.status,
      },
      organization: {
        id: organization?.id,
        name: organization?.name,
        slug: organization?.slug,
      },
    })
  } catch (error: any) {
    console.error('Error resolving invitation:', error)
    res.status(500).json({ error: 'Failed to resolve invitation' })
  }
})

// POST /api/invitations/:token/accept — accept (auth optional via req.user)
router.post('/:token/accept', async (req: any, res) => {
  try {
    const { token } = req.params

    const invitation = await db('organization_invitations')
      .where('token', token)
      .first()

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    // Not authenticated: direct to enroll
    if (!req.user) {
      const enrollUrl = `${process.env.AUTHENTIK_ISSUER_URL || ''}/if/flow/enrollment/`
      return res.status(202).json({
        action: 'enroll',
        enrollUrl,
        message: 'Please create an account or sign in to accept this invitation',
      })
    }

    // Email mismatch
    if (req.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return res.status(403).json({
        error: 'This invitation was sent to a different email address',
      })
    }

    // Already accepted
    if (invitation.status === 'accepted') {
      return res.status(409).json({ error: 'Invitation has already been accepted' })
    }

    // Revoked or expired
    if (invitation.status === 'revoked' || new Date(invitation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invitation has expired or been revoked' })
    }

    // Accept: create membership + mark invitation accepted in a transaction
    await db.transaction(async (trx: any) => {
      // Upsert membership (user may already be a member)
      const existingMembership = await trx('organization_memberships')
        .where('user_id', req.user.id)
        .where('organization_id', invitation.organization_id)
        .first()

      if (!existingMembership) {
        await trx('organization_memberships').insert({
          id: uuidv4(),
          user_id: req.user.id,
          organization_id: invitation.organization_id,
          role: invitation.role,
          status: 'active',
          joined_at: new Date(),
          permissions: JSON.stringify({}),
          metadata: JSON.stringify({}),
        })
      }

      await trx('organization_invitations')
        .where('id', invitation.id)
        .update({ status: 'accepted' })
    })

    // Assign Permit role for the accepted member — non-blocking: a Permit outage
    // must not undo an accepted invitation. The role can be reconciled later.
    try {
      await assignOrganizationRole(
        req.user.id,
        invitation.organization_id,
        invitation.role as 'owner' | 'admin' | 'member' | 'viewer'
      )
    } catch (permitErr) {
      console.error(
        `Permit role assignment failed for user ${req.user.id} in org ${invitation.organization_id} (non-fatal):`,
        permitErr
      )
    }

    res.json({
      message: 'Invitation accepted successfully',
      organizationId: invitation.organization_id,
      role: invitation.role,
    })
  } catch (error: any) {
    console.error('Error accepting invitation:', error)
    res.status(500).json({ error: 'Failed to accept invitation' })
  }
})

export default router
