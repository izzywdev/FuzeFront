import { Knex } from 'knex'
import { ensureBuiltins } from '../app-registry/builtins'

// applications-service seed (dev/bootstrap) — provisions the built-in apps
// (Clock) so they show in the menu locally. Delegates to ensureBuiltins(), the
// single idempotent upsert-by-slug used on every boot (see src/index.ts), so the
// builtin manifest lives in exactly one place. IDEMPOTENT: existing rows are left
// untouched. Production provisioning happens via ensureBuiltins() at startup
// regardless of NODE_ENV; this seed just covers the dev runSeeds() path.
export async function seed(_knex: Knex): Promise<void> {
  await ensureBuiltins()
  console.log('✅ Built-in apps seed delegated to ensureBuiltins (idempotent)')
}
