import { db } from '../config/database'

/**
 * Provision the operator-configured DEFAULT app installs.
 *
 * An app flagged `default_install_personal` is installed (personal / self) for
 * every user; `default_install_org` is installed (org / everyone) for every
 * active org that has an owner. Both inserts are idempotent (ON CONFLICT DO
 * NOTHING against the partial unique indexes from migration 017), so this both
 * BACKFILLS existing users/orgs and picks up any user/org/app that appeared
 * since the last run.
 *
 * Runs at startup AFTER ensureBuiltins (so built-ins like FuzeAgent exist). A
 * user created between boots is covered on the next boot; an instant
 * (identity.user.created) consumer is a planned fast-follow. Failures here are
 * logged and swallowed — provisioning defaults must never crash the service.
 */
export async function provisionDefaultInstalls(): Promise<void> {
  try {
    // Personal defaults → every user, self-anchored (installed_by = the user).
    const personal = await db.raw(`
      INSERT INTO app_installations
        (id, app_id, scope, install_mode, user_id, organization_id,
         installed_by, status, settings, created_at, updated_at)
      SELECT gen_random_uuid(), a.id, 'personal', 'self', u.id, NULL,
             u.id, 'active', '{"source":"default-install"}'::jsonb, now(), now()
        FROM apps a
        CROSS JOIN users u
       WHERE a.default_install_personal = true
         AND a.is_active = true
         -- Skip anyone who already has a row for this app, ACTIVE or REVOKED, so
         -- an explicit uninstall of a removable default is never silently undone
         -- on the next boot (the partial unique index only sees active rows).
         AND NOT EXISTS (
           SELECT 1 FROM app_installations ai
            WHERE ai.app_id = a.id AND ai.user_id = u.id
              AND ai.scope = 'personal'
         )
      ON CONFLICT DO NOTHING
    `)

    // Org defaults → every active org with an owner, installed for everyone.
    const org = await db.raw(`
      INSERT INTO app_installations
        (id, app_id, scope, install_mode, user_id, organization_id,
         installed_by, status, settings, created_at, updated_at)
      SELECT gen_random_uuid(), a.id, 'organization', 'everyone', NULL, o.id,
             o.owner_id, 'active', '{"source":"default-install"}'::jsonb, now(), now()
        FROM apps a
        CROSS JOIN organizations o
       WHERE a.default_install_org = true
         AND a.is_active = true
         AND o.is_active = true
         AND o.owner_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM app_installations ai
            WHERE ai.app_id = a.id AND ai.organization_id = o.id
              AND ai.scope = 'organization'
         )
      ON CONFLICT DO NOTHING
    `)

    const personalCount = personal?.rowCount ?? 0
    const orgCount = org?.rowCount ?? 0
    if (personalCount > 0 || orgCount > 0) {
      console.log(
        `[applications-service] default-installs provisioned: ${personalCount} personal, ${orgCount} org`
      )
    }
  } catch (err) {
    console.error(
      '[applications-service] provisionDefaultInstalls failed (continuing):',
      err instanceof Error ? err.message : err
    )
  }
}
