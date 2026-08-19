import { Knex } from 'knex'
import bcrypt from 'bcrypt'

// The `platform-registrar` service principal created by the backend's
// 014_seed_platform_registrar_user migration.  Every deployed Module-Federation
// remote authenticates to the app-registry with a sealed token bound to this
// UUID, so deleting it breaks app registration cluster-wide until it is
// restored by hand.  Seeds are gated to non-production by a single
// `NODE_ENV !== 'production'` check; exempting the row removes the blast radius
// if that gate is ever bypassed.
const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'

export async function seed(knex: Knex): Promise<void> {
  // Delete existing entries (never the platform-registrar service principal).
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
