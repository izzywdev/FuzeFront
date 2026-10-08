import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import { enqueueEvent } from '@fuzefront/core'
import { TOPICS } from '@fuzefront/shared/kafka'

const router = express.Router()

/**
 * Self-service account management for the authenticated user.
 *
 * Every handler is scoped to the caller's OWN user id (`req.user.id`) — there is
 * no id in the path, so there is no object-level (BOLA) surface: a caller can
 * only ever read/mutate their own row. This is the emit side of
 * `identity.user.updated` / `identity.user.deleted` (FFRNT-172); the events are
 * written to the transactional outbox in the SAME transaction as the change, so
 * they commit atomically with it (mirrors the organization update/delete
 * pattern in routes/organizations.ts).
 */

const NAME_MAX = 255

/** Validate a PATCH /me body: only firstName/lastName, both optional strings. */
function validateProfileInput(body: any): { errors: string[]; firstName?: string; lastName?: string } {
  const errors: string[] = []
  const out: { firstName?: string; lastName?: string } = {}

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Request body must be an object'] }
  }

  const allowed = new Set(['firstName', 'lastName'])
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      errors.push(`Unknown field: ${key}`)
    }
  }

  for (const field of ['firstName', 'lastName'] as const) {
    if (body[field] === undefined) continue
    if (typeof body[field] !== 'string') {
      errors.push(`${field} must be a string`)
      continue
    }
    const trimmed = (body[field] as string).trim()
    if (trimmed.length === 0) {
      errors.push(`${field} must not be empty`)
      continue
    }
    if (trimmed.length > NAME_MAX) {
      errors.push(`${field} must be at most ${NAME_MAX} characters`)
      continue
    }
    out[field] = trimmed
  }

  if (errors.length === 0 && out.firstName === undefined && out.lastName === undefined) {
    errors.push('At least one of firstName, lastName is required')
  }

  return { errors, ...out }
}

/**
 * PATCH /api/me — the authenticated user edits their own profile
 * (first name / last name). Email is intentionally read-only here (changing it
 * requires a re-verification flow). Emits `identity.user.updated` only when a
 * field actually changes.
 */
router.patch('/', authenticateToken, async (req: any, res) => {
  const userId = req.user?.id
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { errors, firstName, lastName } = validateProfileInput(req.body)
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors })
  }

  try {
    let changed = false
    let updatedRow: any

    await db.transaction(async trx => {
      const current = await trx('users').where('id', userId).first()
      if (!current) {
        throw Object.assign(new Error('User not found'), { status: 404 })
      }

      const next: Record<string, any> = { updated_at: new Date() }
      if (firstName !== undefined && firstName !== current.first_name) {
        next.first_name = firstName
        changed = true
      }
      if (lastName !== undefined && lastName !== current.last_name) {
        next.last_name = lastName
        changed = true
      }

      if (!changed) {
        updatedRow = current
        return
      }

      await trx('users').where('id', userId).update(next)
      updatedRow = await trx('users').where('id', userId).first()

      // Emit only on a real change — an unchanged PATCH is a no-op event-wise.
      await enqueueEvent(
        trx,
        TOPICS.IDENTITY_USER_UPDATED,
        {
          userId: updatedRow.id,
          email: updatedRow.email,
          firstName: updatedRow.first_name ?? undefined,
          lastName: updatedRow.last_name ?? undefined,
        },
        `identity-user-updated-${uuidv4()}`
      )
    })

    return res.json({
      user: {
        id: updatedRow.id,
        email: updatedRow.email,
        firstName: updatedRow.first_name,
        lastName: updatedRow.last_name,
      },
      changed,
    })
  } catch (error: any) {
    if (error?.status === 404) {
      return res.status(404).json({ error: 'User not found' })
    }
    console.error('Error updating profile for user', userId, error)
    return res.status(500).json({ error: 'Failed to update profile' })
  }
})

/**
 * DELETE /api/me — the authenticated user deactivates their own account
 * (soft delete: `is_active=false`, `deactivated_at=now()`). Emits
 * `identity.user.deleted` (cascade:'soft') so downstream services tear down the
 * user's external state (Permit principal, sessions) via the provisioning
 * consumer. Idempotent: deactivating an already-inactive account is a no-op and
 * emits no event.
 */
router.delete('/', authenticateToken, async (req: any, res) => {
  const userId = req.user?.id
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    let deactivated = false

    await db.transaction(async trx => {
      const current = await trx('users').where('id', userId).first()
      if (!current) {
        throw Object.assign(new Error('User not found'), { status: 404 })
      }
      if (current.is_active === false) {
        // Already deactivated — idempotent no-op, no event.
        return
      }

      await trx('users').where('id', userId).update({
        is_active: false,
        deactivated_at: new Date(),
        updated_at: new Date(),
      })
      deactivated = true

      await enqueueEvent(
        trx,
        TOPICS.IDENTITY_USER_DELETED,
        {
          userId: current.id,
          email: current.email,
          cascade: 'soft',
        },
        `identity-user-deleted-${uuidv4()}`
      )
    })

    return res.json({ message: 'Account deactivated', deactivated })
  } catch (error: any) {
    if (error?.status === 404) {
      return res.status(404).json({ error: 'User not found' })
    }
    console.error('Error deactivating account for user', userId, error)
    return res.status(500).json({ error: 'Failed to deactivate account' })
  }
})

export default router
