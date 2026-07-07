import { Knex } from 'knex'

// applications-service migration 005 — FuzeAgent menu substitution.
//
// FuzeAgent is a built-in app (see src/app-registry/builtins.ts) and is
// provisioned idempotently on every boot by ensureBuiltins() → upsertBuiltin().
// But upsertBuiltin() does `if (existing) return` — it NEVER updates a row that
// already exists. So changing `chrome.menu` in the built-in manifest from `host`
// to `substitute` only affects FRESH databases; a production row already seeded
// as `host` would stay `host` forever.
//
// This migration patches that already-provisioned row so FuzeAgent SUBSTITUTES
// the portal side menu (it ships its own full navigation), matching the built-in
// manifest. Boot order is migrate → ensureBuiltins, so on a fresh DB where the
// row does not exist yet this UPDATE is a harmless no-op and ensureBuiltins then
// inserts the row with the correct value.
//
// Fully IDEMPOTENT: re-running merges `menu:substitute` into the stored manifest
// again (a no-op once set) and is scoped to the built-in fuzeagent row. jsonb_set
// with create_missing=true plus COALESCE tolerates a manifest that lacks a
// `chrome` object, and preserves any other chrome keys (topbar, items).

export async function up(knex: Knex): Promise<void> {
  // Only touch DBs that actually carry the app-registry manifest column.
  if (!(await knex.schema.hasColumn('apps', 'manifest'))) return

  await knex.raw(`
    UPDATE apps
    SET manifest = jsonb_set(
          manifest,
          '{chrome}',
          COALESCE(manifest -> 'chrome', '{}'::jsonb) || '{"menu":"substitute"}'::jsonb,
          true
        ),
        is_active = true,
        status = 'activated',
        updated_at = now()
    WHERE slug = 'fuzeagent'
      AND builtin = true
      AND manifest IS NOT NULL
  `)
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('apps', 'manifest'))) return

  // Revert the FuzeAgent row to host-owned chrome (the pre-005 value).
  await knex.raw(`
    UPDATE apps
    SET manifest = jsonb_set(
          manifest,
          '{chrome}',
          COALESCE(manifest -> 'chrome', '{}'::jsonb) || '{"menu":"host"}'::jsonb,
          true
        ),
        updated_at = now()
    WHERE slug = 'fuzeagent'
      AND builtin = true
      AND manifest IS NOT NULL
  `)
}
