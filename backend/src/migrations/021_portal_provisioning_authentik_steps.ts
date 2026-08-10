import { Knex } from 'knex'

/**
 * FF-EPIC-11-S4 — adds the two Authentik steps to
 * `portal_provisioning_step_enum`:
 *
 *   - `authentik_redirect_register` — per-domain OIDC redirect URI
 *     registration (AC1/AC3/AC4). An INFRA step (blocking, fail-loud): a
 *     portal must not reach `provisioned-pending-invite` with an
 *     unregistered redirect URI, because that is a silently broken login,
 *     exactly the failure mode AC4 forbids.
 *   - `authentik_brand_register` — per-portal Authentik brand for login
 *     theming (AC2). NOT an infra step — purely cosmetic, so (like
 *     `owner_invite`) its failure is recorded but never blocks/regresses the
 *     portal's status nor fails the overall provisioning call.
 *
 * Adding a step to `services/portalProvisioning.ts`'s
 * `PORTAL_PROVISIONING_STEPS` without extending this enum makes
 * `ensureStepRows()` fail on every provision/resume with "invalid input
 * value for enum portal_provisioning_step_enum" — same failure mode
 * `016_provisioning_steps_rebac.ts` documents for the sibling
 * `organization_provisioning` table, and the same fix shape.
 */

// ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and knex
// wraps migrations in a transaction by default — same reasoning as
// migration 016.
export const config = { transaction: false }

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE portal_provisioning_step_enum ADD VALUE IF NOT EXISTS 'authentik_redirect_register'
  `)
  await knex.raw(`
    ALTER TYPE portal_provisioning_step_enum ADD VALUE IF NOT EXISTS 'authentik_brand_register'
  `)
}

export async function down(_knex: Knex): Promise<void> {
  // Postgres has no ALTER TYPE ... DROP VALUE; the members are left in
  // place, exactly as migration 016 leaves its additions on
  // provisioning_step_enum.
}
