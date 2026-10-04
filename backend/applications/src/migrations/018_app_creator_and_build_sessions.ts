import { Knex } from 'knex'

/**
 * applications-service migration 018 — "build your application" + creator
 * ownership ("org-held, user-originated", like a Drive file in a Workspace).
 *
 * 1. apps.created_by_user_id — who created/published the app. INFORMATIONAL
 *    and immutable once set (enforced by the service: no write path updates it).
 *    The OWNER of record stays apps.organization_id (the personal org for a
 *    personal app, the org for an org app). Authority is Permit + org role,
 *    never this column. ON DELETE SET NULL: deleting the user keeps the app.
 * 2. app_build_sessions — one row per "build with FuzeAgent" run.
 *
 * Idempotent (IF NOT EXISTS / duplicate_object guards) like its siblings: safe
 * to re-run against a database where either piece already exists. Raw SQL so
 * the enum + FK shapes are explicit; `users`/`organizations` are owned by the
 * security-service and shared in one database (see migration 002).
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. apps.created_by_user_id ──────────────────────────────────────────────
  await knex.raw(`
    ALTER TABLE apps
      ADD COLUMN IF NOT EXISTS created_by_user_id uuid NULL
      REFERENCES users(id) ON DELETE SET NULL
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS apps_created_by_user_id_idx
      ON apps (created_by_user_id)
  `)

  // ── 2. app_build_sessions ───────────────────────────────────────────────────
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_build_context_enum AS ENUM ('personal', 'organization');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_build_status_enum AS ENUM (
        'requested', 'launching', 'building', 'deploying',
        'deployed', 'failed', 'cancelled'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `)
  // `id` is minted by the service (mintId('appBuildSession') -> toUuid); the
  // gen_random_uuid() default is only a safety net for manual inserts.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS app_build_sessions (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requested_by_user_id  uuid NULL REFERENCES users(id) ON DELETE SET NULL,
      context               app_build_context_enum NOT NULL,
      name                  text NOT NULL,
      brief                 text NOT NULL,
      status                app_build_status_enum NOT NULL DEFAULT 'requested',
      app_id                uuid NULL REFERENCES apps(id) ON DELETE SET NULL,
      agent_session_ref     text NULL,
      agent_session_url     text NULL,
      error_code            text NULL,
      error_message         text NULL,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS app_build_sessions_org_created_idx
      ON app_build_sessions (organization_id, created_at)
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS app_build_sessions_requester_created_idx
      ON app_build_sessions (requested_by_user_id, created_at)
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS app_build_sessions')
  await knex.raw('DROP TYPE IF EXISTS app_build_status_enum')
  await knex.raw('DROP TYPE IF EXISTS app_build_context_enum')
  await knex.raw('DROP INDEX IF EXISTS apps_created_by_user_id_idx')
  await knex.raw('ALTER TABLE apps DROP COLUMN IF EXISTS created_by_user_id')
}
