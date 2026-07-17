import { Knex } from 'knex'

/**
 * Manage-devices + sign-in-method state.
 *
 * 1. `sessions` gains the device telemetry the `GET /v1/security/sessions`
 *    contract returns (`ip`, `user_agent`, `last_seen_at`). These are recorded
 *    at mint time; the user-agent is parsed into device/browser/os at READ time
 *    (storing the raw string keeps the parser improvable without a backfill).
 *
 * 2. `users` gains a TRI-STATE `has_password` projection:
 *      true    — we know a password sign-in method exists (we set/enrolled it)
 *      false   — we know there is none (social-only account)
 *      NULL    — UNKNOWN (legacy row predating this column)
 *
 *    Why a projection at all: the identity store never exposes password state
 *    over its API (password writes are blueprint-only and `has_usable_password`
 *    is not serialized), so there is NO read path to ask it. This column is the
 *    only available truth, maintained at the points we control (enrollment and
 *    set-password).
 *
 *    NULL is deliberately NOT defaulted to true/false — a wrong guess is unsafe
 *    in BOTH directions (guessing true can strand a social-only user with no way
 *    to sign in after unlinking; guessing false silently permits overwriting a
 *    real password). Unknown is resolved fail-closed per-operation instead:
 *    unlink treats NULL as "no password" (refuses, 409), set-password treats it
 *    as "may set" — so an unknown account converges to a known state safely.
 *
 * Idempotent: every add is guarded by hasColumn, so a re-run is a no-op.
 */
export async function up(knex: Knex): Promise<void> {
  const hasIp = await knex.schema.hasColumn('sessions', 'ip')
  const hasUa = await knex.schema.hasColumn('sessions', 'user_agent')
  const hasSeen = await knex.schema.hasColumn('sessions', 'last_seen_at')

  if (!hasIp || !hasUa || !hasSeen) {
    await knex.schema.alterTable('sessions', table => {
      // `ip` is a plain string, not `inet`: it holds whatever the proxy chain
      // reported (may be IPv4, IPv6, or absent) and is display-only.
      if (!hasIp) table.string('ip').nullable()
      if (!hasUa) table.text('user_agent').nullable()
      if (!hasSeen) table.timestamp('last_seen_at').nullable()
    })
  }

  // Backfill last_seen_at for pre-existing sessions so the device list has a
  // sensible ordering key immediately; created_at is the best known activity.
  if (!hasSeen) {
    await knex('sessions').whereNull('last_seen_at').update({
      last_seen_at: knex.ref('created_at'),
    })
  }

  const hasPwd = await knex.schema.hasColumn('users', 'has_password')
  if (!hasPwd) {
    await knex.schema.alterTable('users', table => {
      // Intentionally nullable with NO default — NULL means "unknown".
      table.boolean('has_password').nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasIp = await knex.schema.hasColumn('sessions', 'ip')
  const hasUa = await knex.schema.hasColumn('sessions', 'user_agent')
  const hasSeen = await knex.schema.hasColumn('sessions', 'last_seen_at')
  if (hasIp || hasUa || hasSeen) {
    await knex.schema.alterTable('sessions', table => {
      if (hasIp) table.dropColumn('ip')
      if (hasUa) table.dropColumn('user_agent')
      if (hasSeen) table.dropColumn('last_seen_at')
    })
  }
  const hasPwd = await knex.schema.hasColumn('users', 'has_password')
  if (hasPwd) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('has_password')
    })
  }
}
