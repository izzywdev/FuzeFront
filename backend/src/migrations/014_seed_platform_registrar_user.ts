import { Knex } from 'knex'

/**
 * Idempotently (re)create the `platform-registrar` service user.
 *
 * WHY THIS IS A MIGRATION AND NOT A SEED
 * --------------------------------------
 * Consuming apps (FuzePicker, and every future Module-Federation remote) call
 * the app-registry with a long-lived HS256 registration token from their
 * `fuzefront-registration` SealedSecret.  That token's `userId` claim is the
 * hard-coded UUID below, so the registry's auth middleware resolves it against
 * the `users` table on every registration.  If the row is absent the registry
 * answers `401 {"error":"User not found"}`, the remote's `register` init
 * container fails, and the pod sits in Init:CrashLoopBackOff — the app is down.
 *
 * Historically this row was only ever created by an ad-hoc manual INSERT, so it
 * existed nowhere in Git.  Any event that rebuilt the database from migrations
 * — most recently the 2026-07-24 storage incident, when the Postgres PVC was
 * reverted off Longhorn and the schema was recreated from scratch (knex batch 1
 * at 2026-07-24 05:18) — silently discarded it and took the picker down until a
 * human noticed and re-inserted it by hand.  That has now happened three times.
 *
 * Seeds cannot fix this: `initializeDatabase()` only calls `runSeeds()` when
 * `NODE_ENV !== 'production'`, so a seed never executes in prod.  Migrations
 * run unconditionally on every backend start AND on every freshly built
 * database, which is exactly the durability property this row needs.
 *
 * The insert is a no-op when the row already exists, so it is safe to re-run
 * and safe on databases where the user was restored by hand.
 */

// Bound to the `userId` claim of the issued registration tokens. Changing this
// value invalidates every already-sealed `fuzefront-registration` secret.
const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'
const PLATFORM_REGISTRAR_EMAIL = 'platform-registrar@fuzefront.internal'

export async function up(knex: Knex): Promise<void> {
  // `ON CONFLICT DO NOTHING` without a conflict target covers *every* unique
  // constraint on the table (both `users_pkey` and `users_email_unique`), so a
  // pre-existing row under either the id or the email is left untouched rather
  // than raising.
  //
  // No `password_hash` is set: this is a token-only service principal and must
  // never be able to complete an interactive password login.
  const result = await knex.raw(
    `INSERT INTO users (id, email, first_name, last_name, roles, email_verified)
     VALUES (?, ?, 'Platform', 'Registrar', ?::json, true)
     ON CONFLICT DO NOTHING`,
    [PLATFORM_REGISTRAR_ID, PLATFORM_REGISTRAR_EMAIL, JSON.stringify(['admin', 'user'])]
  )

  if (result.rowCount > 0) {
    console.log(`[014] created platform-registrar user ${PLATFORM_REGISTRAR_ID}`)
  } else {
    console.log('[014] platform-registrar user already present — nothing to do')
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible. Deleting this row would break app registration
  // for every deployed remote that holds a sealed registration token.
}
