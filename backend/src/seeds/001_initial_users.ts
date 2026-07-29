import { Knex } from 'knex'
import bcrypt from 'bcrypt'

// The `platform-registrar` service principal created by migration
// 014_seed_platform_registrar_user.  Every deployed Module-Federation remote
// authenticates to the app-registry with a sealed token bound to this UUID, so
// deleting it breaks app registration cluster-wide (Init:CrashLoopBackOff on
// every remote) until it is restored by hand.
//
// Seeds are gated to non-production by initializeDatabase(), but that gate is a
// single `NODE_ENV !== 'production'` check — one unset env var between this
// code and a live database would wipe it.  Exempting the row here means the
// dev reset below keeps its full-slate semantics while removing the one
// deletion that has taken production down three times.
const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'

export async function seed(knex: Knex): Promise<void> {
  // Delete dependent data in FK-safe order before removing users.
  // organization_memberships.invited_by and organization_invitations.invited_by
  // reference users.id without an ON DELETE rule, so a bare knex('users').del()
  // fails with a FK violation whenever those columns are populated.  Clear the
  // dependent tables explicitly first so the final users delete always succeeds.
  await knex('organization_provisioning').del()
  await knex('organization_invitations').del()
  await knex('organization_memberships').del()
  await knex('organizations').del()
  await knex('sessions').del()
  await knex('users').whereNot('id', PLATFORM_REGISTRAR_ID).del()

  // Generate password hash for admin
  const adminPasswordHash = await bcrypt.hash('admin123', 10)

  // Insert seed entries for users
  await knex('users').insert([
    {
      id: '8dbf6a1b-c0a1-462a-9bf5-934c8c7339c3',
      email: 'admin@fuzefront.dev',
      password_hash: adminPasswordHash,
      first_name: 'Admin',
      last_name: 'User',
      roles: JSON.stringify(['admin', 'user']),
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: '7bc42d8e-3f2a-4e1b-8c5d-1a9b2c3d4e5f',
      email: 'demo@fuzefront.dev',
      password_hash: await bcrypt.hash('demo123', 10),
      first_name: 'Demo',
      last_name: 'User',
      roles: JSON.stringify(['user']),
      created_at: new Date(),
      updated_at: new Date(),
    },
  ])

  console.log('✅ Users seeded successfully')
}
