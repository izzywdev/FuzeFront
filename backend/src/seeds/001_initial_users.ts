import { Knex } from 'knex'
import bcrypt from 'bcrypt'

export async function seed(knex: Knex): Promise<void> {
  // Delete existing entries
  await knex('users').del()

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
