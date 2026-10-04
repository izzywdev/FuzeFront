import type { Knex } from 'knex'
import { db as defaultDb } from '../config/database'

/**
 * Internal/administrative role machinery. Kept in a service (not inline in
 * routes/internal.ts) deliberately: the scope-to-portal leak guard
 * (tests/scope-to-portal-guard.test.ts, FF-EPIC-11-S2) requires every
 * `routes/*.ts` that reads `db('users')` to route through `scopeToPortal`,
 * because a raw users read in a route is usually a listing/search/profile of
 * ANOTHER user. This is not that: it is an internal S2S/admin grant that
 * resolves ONE user by exact email, which the guard's own docstring lists as a
 * `services/*.ts` exemption ("internal provisioning/administrative machinery …
 * not an HTTP listing/search/profile response"). Portal scoping does not apply.
 */

/** Roles an internal caller may assign. Keep this list TIGHT — each entry is a
 * privilege the /internal/set-roles shared-secret can hand out. `admin` is here
 * solely so synthetic/break-glass accounts (e.g. the post-prod master-admin
 * smoke) can be provisioned without a manual prod DB write; real per-resource
 * authorization still lives in Permit, never in this marker. */
export const ASSIGNABLE_ROLES = new Set(['user', 'admin', 'developer', 'employee'])

export interface SetRolesResult {
  userId: string
  email: string
  roles: string[]
}

/**
 * Set a user's `users.roles` by exact (case-insensitive) email. Normalises to
 * always include `user` and dedupes, so a re-run is a no-op. Returns the
 * updated identity, or `null` when no user matches that email.
 *
 * Callers validate `roles` against ASSIGNABLE_ROLES before calling.
 */
export async function setUserRolesByEmail(
  email: string,
  roles: string[],
  db: Knex = defaultDb
): Promise<SetRolesResult | null> {
  const normalized = Array.from(new Set(['user', ...roles]))
  const user = await db('users').whereRaw('LOWER(email) = LOWER(?)', [email]).first()
  if (!user) return null
  await db('users')
    .where({ id: user.id })
    .update({ roles: JSON.stringify(normalized), updated_at: db.fn.now() })
  return { userId: user.id, email: user.email, roles: normalized }
}
