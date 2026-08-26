/**
 * Monolith copy of `backend/security/tests/
 * personalOrgOverReclassificationRepairMigration.test.ts`, proving migration
 * 025 (forward repair for the 2026-08-23 personal-org over-reclassification
 * incident) restores affected rows, is idempotent, and never destroys a
 * duplicate org that has real content. Uses the shared jest global setup
 * (tests/setup.ts — real Postgres, full migration chain already applied in
 * beforeAll, which includes 025 itself since it runs on every boot) and then
 * invokes migration 025's `up()` directly against damaged rows inserted by
 * each test.
 */
import { v4 as uuidv4 } from 'uuid'

import { db, initializeDatabaseConnection } from '../src/config/database'
import * as migration025 from '../src/migrations/025_repair_personal_org_over_reclassification'

beforeAll(() => {
  initializeDatabaseConnection()
})

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `repair-${id.slice(0, 8)}@test.local`,
    first_name: 'Repair',
    last_name: 'Test',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

/** Inserts an org row already in the DAMAGED state migration 022's
 * unconditional (b) step used to produce: `type='organization'` but still
 * carrying the `metadata.personal = true` stamp only `ensurePersonalOrg`
 * ever writes. */
async function createDamagedPersonalOrg(
  ownerId: string,
  opts: { slug?: string } = {}
): Promise<string> {
  const id = uuidv4()
  await db('organizations').insert({
    id,
    name: 'Personal',
    slug: opts.slug ?? `personal-${id.slice(0, 8)}`,
    owner_id: ownerId,
    type: 'organization', // <-- incorrectly reclassified
    settings: JSON.stringify({}),
    metadata: JSON.stringify({ personal: true }),
    is_active: true,
    provisioning_state: 'pending',
  })
  return id
}

async function createLegitimateOrg(ownerId: string): Promise<string> {
  const id = uuidv4()
  await db('organizations').insert({
    id,
    name: 'Acme Inc',
    slug: `acme-${id.slice(0, 8)}`,
    owner_id: ownerId,
    type: 'organization',
    settings: JSON.stringify({}),
    metadata: JSON.stringify({}), // no personal stamp — never touched
    is_active: true,
    provisioning_state: 'pending',
  })
  return id
}

async function insertOwnerMembership(orgId: string, ownerId: string): Promise<void> {
  await db('organization_memberships').insert({
    id: uuidv4(),
    user_id: ownerId,
    organization_id: orgId,
    role: 'owner',
    status: 'active',
    joined_at: new Date(),
    permissions: JSON.stringify({}),
    metadata: JSON.stringify({}),
  })
}

describe('migration 025 — personal-org over-reclassification repair (2026-08-23 incident, monolith)', () => {
  it('restores a reclassified row back to type=personal, non-destructively', async () => {
    const owner = await createUser()
    const orgId = await createDamagedPersonalOrg(owner)
    await insertOwnerMembership(orgId, owner)

    await migration025.up(db)

    const org = await db('organizations').where({ id: orgId }).first()
    expect(org.type).toBe('personal')
    expect(org.owner_id).toBe(owner)
    expect(org.is_active).toBe(true)
    const metadata =
      typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata
    expect(metadata).toEqual({ personal: true })
  })

  it('does not touch a legitimate organization that never carried the personal stamp', async () => {
    const owner = await createUser()
    const orgId = await createLegitimateOrg(owner)

    await migration025.up(db)

    const org = await db('organizations').where({ id: orgId }).first()
    expect(org.type).toBe('organization')
  })

  it('is idempotent: running it twice produces no diff on the second run', async () => {
    const owner = await createUser()
    const orgId = await createDamagedPersonalOrg(owner)
    await insertOwnerMembership(orgId, owner)

    await migration025.up(db)
    const afterFirst = await db('organizations').where({ id: orgId }).first()
    expect(afterFirst.type).toBe('personal')

    await expect(migration025.up(db)).resolves.toBeUndefined()

    const afterSecond = await db('organizations').where({ id: orgId }).first()
    expect(afterSecond.type).toBe('personal')
    expect(afterSecond.updated_at.getTime()).toBe(afterFirst.updated_at.getTime())
  })

  it('removes an EMPTY duplicate personal org to make way for the restore', async () => {
    const owner = await createUser()
    const damagedOrgId = await createDamagedPersonalOrg(owner)
    await insertOwnerMembership(damagedOrgId, owner)

    // A second, genuinely empty, personal-type org for the same owner — the
    // accidental duplicate a retried `ensurePersonalOrg` could produce.
    const duplicateId = uuidv4()
    await db('organizations').insert({
      id: duplicateId,
      name: 'Personal',
      slug: `personal-dup-${duplicateId.slice(0, 8)}`,
      owner_id: owner,
      type: 'personal',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({ personal: true }),
      is_active: true,
      provisioning_state: 'pending',
    })
    await insertOwnerMembership(duplicateId, owner)

    await migration025.up(db)

    const restored = await db('organizations').where({ id: damagedOrgId }).first()
    expect(restored.type).toBe('personal')

    const duplicate = await db('organizations').where({ id: duplicateId }).first()
    expect(duplicate).toBeUndefined() // removed
  })

  it('REFUSES to remove a duplicate that has content — skips the restore instead', async () => {
    const owner = await createUser()
    const otherMember = await createUser()
    const damagedOrgId = await createDamagedPersonalOrg(owner)
    await insertOwnerMembership(damagedOrgId, owner)

    // A second personal-type org for the same owner, but with a REAL extra
    // member — this one must never be deleted.
    const duplicateId = uuidv4()
    await db('organizations').insert({
      id: duplicateId,
      name: 'Personal',
      slug: `personal-content-${duplicateId.slice(0, 8)}`,
      owner_id: owner,
      type: 'personal',
      settings: JSON.stringify({}),
      metadata: JSON.stringify({ personal: true }),
      is_active: true,
      provisioning_state: 'pending',
    })
    await insertOwnerMembership(duplicateId, owner)
    await db('organization_memberships').insert({
      id: uuidv4(),
      user_id: otherMember,
      organization_id: duplicateId,
      role: 'member',
      status: 'active',
      joined_at: new Date(),
      permissions: JSON.stringify({}),
      metadata: JSON.stringify({}),
    })

    await migration025.up(db)

    // Neither row was touched: the damaged row is left as-is (not restored,
    // because restoring it would collide with the content-bearing duplicate
    // on `uq_personal_org_per_owner`), and the duplicate is untouched.
    const damaged = await db('organizations').where({ id: damagedOrgId }).first()
    expect(damaged.type).toBe('organization')

    const duplicate = await db('organizations').where({ id: duplicateId }).first()
    expect(duplicate).toBeDefined()
    expect(duplicate.type).toBe('personal')
  })
})
