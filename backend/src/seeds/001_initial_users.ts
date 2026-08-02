import { Knex } from 'knex'
import bcrypt from 'bcrypt'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'

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
  // The ROOT platform organization (migration 015) is exempted for the same
  // reason PLATFORM_REGISTRAR_ID is exempted below: migrations create it, and a
  // bare `organizations().del()` here deletes it again on every dev reset — so
  // the root org exists only until the first seed run. That breaks the portal
  // root, leaves `ensureRootOrgAdmins()` with nothing to grant on, and makes
  // every new org skip its `parent` link to the root. Production never runs
  // seeds, so this bites dev and CI only — which is precisely where it is
  // hardest to notice and easiest to mistake for "the feature doesn't work".
  await knex('organization_provisioning')
    .whereNot('organization_id', ROOT_ORG_ID)
    .del()
  await knex('organization_invitations').del()
  await knex('organization_memberships')
    .whereNot('organization_id', ROOT_ORG_ID)
    .del()
  await knex('organizations').whereNot('id', ROOT_ORG_ID).del()
  await knex('sessions').del()
  // Keep the root org's owner too — deleting it would cascade the org away
  // (organizations.owner_id → users.id ON DELETE CASCADE), undoing the exemption
  // above. In practice this is the registrar, already exempt; the subquery keeps
  // it correct if ownership is ever moved to a real administrator.
  const rootOwnerIds = await knex('organizations')
    .where({ id: ROOT_ORG_ID })
    .pluck('owner_id')
  await knex('users')
    .whereNot('id', PLATFORM_REGISTRAR_ID)
    .whereNotIn('id', rootOwnerIds)
    .del()

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
