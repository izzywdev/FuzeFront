import crypto from 'crypto'
import express from 'express'
import { db } from '../config/database'
import {
  runInternalProvision,
  ensureDeveloperMembership,
} from '../services/organizationProvisioning'
import { isDevportalEnabled } from '../utils/devportalFlag'

const router = express.Router()

/**
 * Shared-secret gate for the internal (cluster-only, never ingress-exposed)
 * endpoints. Constant-time compare against INTERNAL_PROVISION_SECRET; fails
 * closed when the secret is unset. Returns true when the caller is authorised.
 */
function internalSecretOk(req: express.Request): boolean {
  const expected = process.env.INTERNAL_PROVISION_SECRET
  const provided = req.header('x-internal-secret')
  const a = Buffer.from(provided || '')
  const b = Buffer.from(expected || '')
  return Boolean(
    expected && provided && a.length === b.length && crypto.timingSafeEqual(a, b)
  )
}

/** Roles a caller may assign via /internal/set-roles. Keep this list TIGHT —
 * each entry is a privilege this endpoint can hand out behind the shared
 * secret. `admin` is here solely so synthetic/break-glass accounts (e.g. the
 * post-prod master-admin smoke) can be provisioned without a manual prod DB
 * write; real per-resource authorization still lives in Permit. */
const ASSIGNABLE_ROLES = new Set(['user', 'admin', 'developer', 'employee'])

/**
 * Neutralise a value before it reaches a log line.
 *
 * These handlers are request paths: the request-supplied `userId` is echoed
 * back inside provisioning error messages, so an unsanitised value could
 * inject CR/LF and forge whole log entries (log injection), or smuggle
 * `%s`/`%d` format specifiers into a format string. Control characters are
 * escaped rather than dropped so the information content is preserved, and
 * the result is length-capped so one request cannot flood the log.
 */
function sanitizeForLog(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\p{Cc}/gu, ' ')
    .slice(0, 2000)
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
    console.error(
      'Internal provision failed: %s',
      sanitizeForLog(error?.stack ?? error?.message ?? error)
    )
    return res
      .status(500)
      .json({ error: 'Provisioning failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service devportal-provisioning endpoint.
 *
 * docs/planning/developers-portal.md §5.2 — devportal-service calls this
 * (never the public ingress) right after a user's FIRST successful OIDC
 * sign-in at developers.fuzefront.com, so root-org `developer` membership is
 * single-sourced here rather than duplicated into devportal-service's own DB.
 * Same shared-secret auth as /provision. Fails closed (404) while
 * `fuzefront.devportal.enabled` is OFF — the whole capability is dark.
 *
 *   POST /internal/devportal-provision
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>" }
 *   200 { ok: true }
 *   400 { error } missing userId
 *   401 { error } bad/missing secret
 *   404 { error } devportal flag is OFF
 *
 * Idempotent; safe to retry.
 */
router.post('/devportal-provision', async (req, res) => {
  const expected = process.env.INTERNAL_PROVISION_SECRET
  const provided = req.header('x-internal-secret')

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

  if (!(await isDevportalEnabled({ userId }))) {
    return res.status(404).json({ error: 'Not found' })
  }

  try {
    await ensureDeveloperMembership(userId)
    return res.status(200).json({ ok: true })
  } catch (error: any) {
    console.error(
      'Internal devportal-provision failed: %s',
      sanitizeForLog(error?.stack ?? error?.message ?? error)
    )
    return res
      .status(500)
      .json({ error: 'Provisioning failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service role-assignment endpoint.
 *
 * Sets a user's `users.roles` by email. Its reason to exist: the platform has
 * NO self-serve admin grant — public signup only ever mints `["user"]`, and the
 * master-admin directory (`GET /api/v1/admin/portals`) gates on
 * `requireRole(['admin'])`. Provisioning a synthetic/break-glass admin (e.g. the
 * post-prod Portals smoke's `postprod-admin@…`) otherwise means a hand-run prod
 * DB `UPDATE`. This endpoint single-sources that write behind the same
 * `x-internal-secret` gate as `/provision`, so a dispatchable in-cluster ops
 * workflow can do it instead of a human touching the database.
 *
 *   POST /internal/set-roles
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "email": "<address>", "roles": ["admin"] }
 *   200 { ok: true, userId, email, roles }   (roles normalised: `user` always included, deduped)
 *   400 { error }  missing email / roles not a non-empty string[] / unknown role
 *   401 { error }  bad/missing secret (or secret not configured)
 *   404 { error }  no user with that email
 *
 * Cluster-internal ONLY (never ingress-exposed — see templates/ingress.yaml and
 * index.ts's `/internal` mount). `roles` is validated against ASSIGNABLE_ROLES
 * so the shared secret cannot hand out an arbitrary/unknown role. Idempotent.
 * Authorization for real actions still comes from the token + Permit; a role in
 * `users.roles` is a rollout/break-glass marker, never the capability itself.
 */
router.post('/set-roles', async (req, res) => {
  if (!internalSecretOk(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { email, roles } = req.body || {}
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' })
  }
  if (
    !Array.isArray(roles) ||
    roles.length === 0 ||
    !roles.every(r => typeof r === 'string')
  ) {
    return res.status(400).json({ error: 'roles must be a non-empty array of strings' })
  }
  const invalid = roles.filter(r => !ASSIGNABLE_ROLES.has(r))
  if (invalid.length > 0) {
    return res
      .status(400)
      .json({ error: `unknown role(s): ${invalid.map(sanitizeForLog).join(', ')}` })
  }

  // Normalise: `user` is the base role every account carries; dedupe so a
  // re-run is a no-op rather than appending.
  const normalized = Array.from(new Set(['user', ...roles]))

  try {
    const user = await db('users')
      .whereRaw('LOWER(email) = LOWER(?)', [email])
      .first()
    if (!user) {
      return res.status(404).json({ error: 'user not found' })
    }
    await db('users')
      .where({ id: user.id })
      .update({ roles: JSON.stringify(normalized), updated_at: db.fn.now() })
    return res.status(200).json({ ok: true, userId: user.id, email: user.email, roles: normalized })
  } catch (error: any) {
    // Deliberately do NOT interpolate the request-supplied `email` into the log
    // sink: it is user-controlled, and even sanitised, feeding it to the log is
    // the log-injection taint path CodeQL flags. The error alone is the needed
    // diagnostic for the only thing that reaches here (a DB failure).
    console.error(
      'Internal set-roles failed: %s',
      sanitizeForLog(error?.stack ?? error?.message ?? error)
    )
    return res
      .status(500)
      .json({ error: 'set-roles failed', detail: String(error?.message ?? error) })
  }
})

export default router
