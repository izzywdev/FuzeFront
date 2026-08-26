import crypto from 'crypto'
import express from 'express'
import {
  runInternalProvision,
  deprovisionOrganization,
} from '../services/organizationProvisioning'
import {
  syncUserProfile,
  deprovisionUser,
} from '../services/userLifecycle'

const router = express.Router()

/**
 * Constant-time check of the shared `x-internal-secret` header against
 * INTERNAL_PROVISION_SECRET. Fails closed when the secret is unconfigured.
 */
function isAuthorized(req: express.Request): boolean {
  const expected = process.env.INTERNAL_PROVISION_SECRET
  const provided = req.header('x-internal-secret')
  const a = Buffer.from(provided || '')
  const b = Buffer.from(expected || '')
  return !(
    !expected ||
    !provided ||
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  )
}

/**
 * Internal, service-to-service provisioning endpoint.
 *
 * Plan D's provisioning-service calls this so that ALL provisioning logic stays
 * single-sourced in the backend. Authenticated by a shared secret carried in the
 * `x-internal-secret` header and compared against `INTERNAL_PROVISION_SECRET`
 * (from env / a chart Secret). NEVER expose this through the public ingress.
 *
 *   POST /internal/provision
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>" }
 *   200 { ok: true, personalOrgId, reconciled: [{ orgId, state }] }
 *     `personalOrgId` is `null` when `fuzefront.identity.root-membership` is
 *     ON — no personal org is created in that path (FF-EPIC-17-S1); the user
 *     is instead upserted as a root-org member (see `ensureRootMembership`).
 *   400 { error } missing userId
 *   401 { error } bad/missing secret (or secret not configured)
 *
 * Idempotent; safe to retry.
 */
router.post('/provision', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId } = req.body || {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' })
  }

  try {
    const result = await runInternalProvision(userId)
    return res.status(200).json({ ok: true, ...result })
  } catch (error: any) {
    console.error('Internal provision failed:', error)
    return res
      .status(500)
      .json({ error: 'Provisioning failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service DE-provisioning endpoint — the teardown mirror of
 * /provision, called by provisioning-service on `identity.org.deleted`.
 *
 *   POST /internal/deprovision
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "organizationId": "<uuid>", "cascade": "soft" | "hard" }
 *   200 { ok: true, organizationId, cascade, rolesRevoked, tenantDeleted }
 *   400 { error } missing organizationId
 *   401 { error } bad/missing secret
 *
 * Idempotent + best-effort; safe to retry.
 */
router.post('/deprovision', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { organizationId, cascade } = req.body || {}
  if (!organizationId || typeof organizationId !== 'string') {
    return res.status(400).json({ error: 'organizationId is required' })
  }
  const mode: 'soft' | 'hard' = cascade === 'hard' ? 'hard' : 'soft'

  try {
    const result = await deprovisionOrganization(organizationId, mode)
    return res.status(200).json({ ok: true, ...result })
  } catch (error: any) {
    console.error('Internal deprovision failed:', error)
    return res
      .status(500)
      .json({ error: 'Deprovisioning failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service user profile re-sync endpoint — called by
 * provisioning-service on `identity.user.updated` to mirror the user's profile
 * into Permit.
 *
 *   POST /internal/user-sync
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>", "email": "<email>", "firstName"?, "lastName"? }
 *   200 { ok: true, userId, permitSynced }
 *   400 { error } missing userId/email
 *   401 { error } bad/missing secret
 *
 * Idempotent + best-effort; safe to retry.
 */
router.post('/user-sync', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId, email, firstName, lastName } = req.body || {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' })
  }
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' })
  }

  try {
    const result = await syncUserProfile({ userId, email, firstName, lastName })
    return res.status(200).json({ ok: true, ...result })
  } catch (error: any) {
    console.error('Internal user-sync failed:', error)
    return res
      .status(500)
      .json({ error: 'User sync failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service user teardown endpoint — the mirror of
 * /user-sync, called by provisioning-service on `identity.user.deleted`. Deletes
 * the Permit principal and revokes the user's sessions.
 *
 *   POST /internal/user-delete
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>", "cascade": "soft" | "hard" }
 *   200 { ok: true, userId, cascade, permitDeleted, sessionsRevoked }
 *   400 { error } missing userId
 *   401 { error } bad/missing secret
 *
 * Idempotent + best-effort; safe to retry.
 */
router.post('/user-delete', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId, cascade } = req.body || {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' })
  }
  const mode: 'soft' | 'hard' = cascade === 'hard' ? 'hard' : 'soft'

  try {
    const result = await deprovisionUser(userId, mode)
    return res.status(200).json({ ok: true, ...result })
  } catch (error: any) {
    console.error('Internal user-delete failed:', error)
    return res
      .status(500)
      .json({ error: 'User delete failed', detail: String(error?.message ?? error) })
  }
})

export default router
