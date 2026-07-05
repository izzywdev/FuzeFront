import crypto from 'crypto'
import express from 'express'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

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
 *   400 { error } missing userId
 *   401 { error } bad/missing secret (or secret not configured)
 *
 * Idempotent; safe to retry.
 */
router.post('/provision', async (req, res) => {
  const expected = process.env.INTERNAL_PROVISION_SECRET
  const provided = req.header('x-internal-secret')

  // Fail closed: if no secret is configured the endpoint is unusable; use a
  // constant-time compare (I1) to prevent timing-based secret oracle attacks.
  const a = Buffer.from(provided || '')
  const b = Buffer.from(expected || '')
  const unauthorised =
    !expected || !provided || a.length !== b.length || !crypto.timingSafeEqual(a, b)
  if (unauthorised) {
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

export default router
