import { Knex } from 'knex'

// The `platform-registrar` service principal created by the backend's
// 014_seed_platform_registrar_user migration.  Every deployed Module-Federation
// remote authenticates to the app-registry with a sealed token bound to this
// UUID, so deleting it breaks app registration cluster-wide until it is
// restored by hand.  Seeds are gated to non-production by a single
// `NODE_ENV !== 'production'` check; exempting the row removes the blast radius
// if that gate is ever bypassed.
const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Dev-only fixture users for the security service.
 *
 * NO LOCAL PASSWORDS ARE SEEDED HERE, deliberately.  AuthN for this platform is
 * FuzeFront's Authentik OIDC — products do not store or verify user passwords
 * (governance/architecture-guidelines.md §1), and `users.password_hash` is
 * nullable precisely so a row can exist as a token-only principal (the same
 * shape migration 014_seed_platform_registrar_user uses).  These rows therefore
 * carry no `password_hash`: they are OIDC/token identities, and local login
 * against them is impossible by construction.
 *
 * This previously hashed two hard-coded literals (`admin123` / `demo123`) into
 * `password_hash`, which meant a single unset `NODE_ENV` between this code and
 * a live database would have planted a known-password `admin` account.  That is
 * a backdoor, not a fixture — see the production guard below.
 *
 * If you need an administrator you can log into locally, use the env-driven,
 * non-destructive bootstrap instead: `src/scripts/seed-admin.ts`, which reads
 * `FUZEFRONT_ADMIN_EMAIL` / `FUZEFRONT_ADMIN_PASSWORD` from the environment and
 * has no default password at all.
 */
export async function seed(knex: Knex): Promise<void> {
  // Second line of defence behind initializeDatabase()'s
  // `NODE_ENV !== 'production'` gate (backend/core/src/config/database.ts).
  // This seed truncates the `users` table; a single misconfigured env var must
  // not be all that stands between it and a real database.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '001_initial_users is a development-only seed and must never run with NODE_ENV=production'
    )
  }

  // Delete existing entries (never the platform-registrar service principal).
  await knex('users').whereNot('id', PLATFORM_REGISTRAR_ID).del()

  // Insert seed entries for users.  password_hash is intentionally omitted —
  // these identities authenticate through Authentik OIDC, not a local password.
  await knex('users').insert([
    {
      id: '8dbf6a1b-c0a1-462a-9bf5-934c8c7339c3',
      email: 'admin@fuzefront.dev',
      first_name: 'Admin',
      last_name: 'User',
      roles: JSON.stringify(['admin', 'user']),
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: '7bc42d8e-3f2a-4e1b-8c5d-1a9b2c3d4e5f',
      email: 'demo@fuzefront.dev',
      first_name: 'Demo',
      last_name: 'User',
      roles: JSON.stringify(['user']),
      created_at: new Date(),
      updated_at: new Date(),
    },
  ])

  console.log(
    '✅ Users seeded successfully (OIDC-only — no local passwords; use scripts/seed-admin.ts with FUZEFRONT_ADMIN_PASSWORD if you need local login)'
  )
}
