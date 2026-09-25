import type { Knex } from 'knex'
import { ROOT_ORG_ID } from './014_seed_root_platform_organization'

/**
 * FF-EPIC-17 — security-service copy of
 * `backend/src/migrations/029_set_root_owner_and_backfill_memberships.ts`
 * (mirror per the epic's "mirror into the non-live backend copy" DoD). See that
 * file's header for the full #750 write-up.
 *
 * The two remaining halves of #750 that the additive root seed left open:
 *   (1) an EXPLICIT platform owner on the root org (the additive seed set the
 *       registrar/oldest user, not a person), and
 *   (2) universal root membership (migration 015's step (a) skipped while …010
 *       was absent and knex will not re-run it, so every human is still a GUEST
 *       of root).
 *
 * Idempotent; NEVER throws — an absent root is a logged skip (its creation is
 * owned by the additive seed / 014), not an error.
 */

const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'
// The platform owner. Overridable via env for non-prod / future handoff; the
// default names the current owner so prod resolves deterministically even
// before that env is wired. Not a secret (it is the repo's CODEOWNER).
const DEFAULT_ROOT_OWNER_EMAIL = 'izzy.weinberg@gmail.com'

interface UserRow {
  id: string
}

async function resolveOwner(knex: Knex): Promise<UserRow | undefined> {
  const email = process.env.ROOT_OWNER_EMAIL || DEFAULT_ROOT_OWNER_EMAIL
  return (
    (await knex('users').whereRaw('lower(email) = lower(?)', [email]).first()) ??
    (await knex('users')
      .whereNot({ id: PLATFORM_REGISTRAR_ID })
      .orderBy('created_at', 'asc')
      .first()) ??
    (await knex('users').where({ id: PLATFORM_REGISTRAR_ID }).first())
  )
}

export async function up(knex: Knex): Promise<void> {
  const owner = await resolveOwner(knex)
  if (!owner) {
    console.log('[019] no users yet — nothing to own or backfill')
    return
  }

  const root = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!root) {
    console.log(
      `[019] root organization ${ROOT_ORG_ID} is absent — skipping owner/backfill. ` +
        'Its creation is owned by the additive root seed / 014; this migration runs the ' +
        'owner + membership backfill once that row exists. No changes made.'
    )
    return
  }

  if (root.owner_id !== owner.id) {
    await knex('organizations').where({ id: ROOT_ORG_ID }).update({ owner_id: owner.id })
    console.log(`[019] set root ${ROOT_ORG_ID} owner_id ${root.owner_id ?? '<null>'} -> ${owner.id}`)
  }

  await knex.raw(
    `INSERT INTO organization_memberships
       (id, user_id, organization_id, role, status, joined_at, permissions, metadata)
     VALUES (gen_random_uuid(), ?, ?, 'owner', 'active', NOW(), '{}'::jsonb, '{}'::jsonb)
     ON CONFLICT (user_id, organization_id)
       DO UPDATE SET role = 'owner', status = 'active'`,
    [owner.id, ROOT_ORG_ID]
  )

  const backfill = await knex.raw(
    `INSERT INTO organization_memberships
       (id, user_id, organization_id, role, status, joined_at, permissions, metadata)
     SELECT gen_random_uuid(), u.id, ?, 'member', 'active', NOW(), '{}'::jsonb, '{}'::jsonb
       FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM organization_memberships om
         WHERE om.user_id = u.id AND om.organization_id = ?
      )
     ON CONFLICT (user_id, organization_id) DO NOTHING`,
    [ROOT_ORG_ID, ROOT_ORG_ID]
  )
  const inserted = (backfill as { rowCount?: number }).rowCount ?? 0
  console.log(`[019] root owner=${owner.id}; backfilled ${inserted} member row(s)`)
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible — same rationale as migration 014's down().
}
