import type { Knex } from 'knex'
import { ROOT_ORG_ID } from './015_seed_root_platform_organization'

/**
 * FF-EPIC-17 — the two remaining halves of #750 that migration 028
 * (`028_seed_root_platform_organization_additively`) deliberately left open:
 *
 *   (1) an EXPLICIT platform owner on the root org, and
 *   (2) universal root membership (so "member of root ≡ user of the platform").
 *
 * WHY THIS IS SEPARATE FROM 028. 028 chose REPARENT-over-repoint (owner ruling
 * 2026-09-14): it seeds ROOT_ORG_ID (…010) ADDITIVELY under a non-`fuzefront`
 * slug — the real `fuzefront` slug stays on the adopted 2026-07-29 platform
 * org — and gives it an `owner` membership for the platform REGISTRAR (or the
 * oldest user), which is a bootstrap identity, not a person. It does NOT
 * backfill a membership for every other user: migration 022's step (a) was
 * meant to, but it ran while …010 was still absent and SKIPPED, and knex will
 * not re-run it. So after 028, every human — including the platform owner —
 * is still a GUEST of the root org, and the root has no human owner. This
 * migration closes both.
 *
 * WHAT IT DOES (idempotent; NEVER throws — a throwing migration is the #750
 * crashloop, so an absent root is a logged skip, not an error):
 *   1. Resolve the platform owner: `ROOT_OWNER_EMAIL` env, else the documented
 *      default owner email, else the oldest non-registrar user.
 *   2. If …010 exists: set `organizations.owner_id` to that user and give them
 *      an `owner` membership (upgrading an existing member/other row).
 *   3. Backfill a `member` row for every OTHER user (022 step (a), now that
 *      …010 exists), via NOT EXISTS + ON CONFLICT DO NOTHING.
 *   If …010 does NOT exist (a DB where 028/015 both deferred — e.g. no users,
 *   or the reparent has not landed), this logs and returns without mutating.
 *
 * SCOPE: this operates on the canonical literal ROOT_ORG_ID (…010) — the id
 * the ~30 authz/portal/ReBAC call sites resolve. It deliberately does NOT
 * touch the adopted legacy `fuzefront` org; converging those two is the
 * repoint decision 028's header explains was declined.
 *
 * Mirrored into `backend/security/src/migrations/019_set_root_owner_and_backfill_memberships.ts`.
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
    console.log('[029] no users yet — nothing to own or backfill')
    return
  }

  const root = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!root) {
    console.log(
      `[029] root organization ${ROOT_ORG_ID} is absent — skipping owner/backfill. ` +
        'Its creation is owned by migration 028 (additive seed) / 015; this migration ' +
        'runs the owner + membership backfill once that row exists. No changes made.'
    )
    return
  }

  // (1) Make the resolved platform owner the explicit owner of the root org.
  if (root.owner_id !== owner.id) {
    await knex('organizations').where({ id: ROOT_ORG_ID }).update({ owner_id: owner.id })
    console.log(`[029] set root ${ROOT_ORG_ID} owner_id ${root.owner_id ?? '<null>'} -> ${owner.id}`)
  }

  await knex.raw(
    `INSERT INTO organization_memberships
       (id, user_id, organization_id, role, status, joined_at, permissions, metadata)
     VALUES (gen_random_uuid(), ?, ?, 'owner', 'active', NOW(), '{}'::jsonb, '{}'::jsonb)
     ON CONFLICT (user_id, organization_id)
       DO UPDATE SET role = 'owner', status = 'active'`,
    [owner.id, ROOT_ORG_ID]
  )

  // (2) Backfill a `member` row for every OTHER user (022 step (a), deferred
  // until …010 existed). NOT EXISTS skips the owner (already has a row) and
  // anyone already a member; ON CONFLICT DO NOTHING closes the race.
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
  console.log(`[029] root owner=${owner.id}; backfilled ${inserted} member row(s)`)
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible: reverting would re-strip the root's human owner
  // and the universal memberships the rest of the system keys off — the exact
  // pre-#750 orphan state. Same rationale as migrations 015 and 028's down().
}
