/**
 * FF-EPIC-17-S1 — monolith copy of `backend/security/tests/
 * organizationProvisioning.rootMembership.test.ts`. Uses the shared jest
 * global setup (tests/setup.ts — real Postgres, full migration chain incl.
 * 022, already applied in beforeAll) exactly like provisioning.test.ts.
 *
 * Exercises BOTH flag states per the `feature-flags` skill's "test BOTH
 * states" rule:
 *   - OFF (default): today's personal-org behavior, byte-identical, zero
 *     regression, no root membership row created as a side effect.
 *   - ON: root-org `member` upsert, idempotent, no personal org created,
 *     `assignOrganizationRole` called so Permit's tenant role tracks it.
 */
import { v4 as uuidv4 } from 'uuid'

import { db, initializeDatabaseConnection } from '../src/config/database'
import {
  ensurePersonalOrg,
  ensureRootMembership,
  runInternalProvision,
  ProvisioningDeps,
} from '../src/services/organizationProvisioning'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'
import * as rootMembershipFlagModule from '../src/utils/rootMembershipFlag'

beforeAll(() => {
  initializeDatabaseConnection()
})

function deps(overrides?: Partial<ProvisioningDeps>): Partial<ProvisioningDeps> {
  return {
    db,
    permit: {
      async syncUser() {},
      async createTenant() {},
      async createOrgInstance() {},
      async linkParent() {},
      async assignOwnerRole() {},
    },
    publish: {
      async publishIdentityUserCreated() {},
      async publishNotifyEmailRequested() {},
      async publishPortalCreated() {},
    },
    ...overrides,
  }
}

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `root-mem-${id.slice(0, 8)}@test.local`,
    first_name: 'Root',
    last_name: 'Mem',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

describe('organizationProvisioning — root membership (FF-EPIC-17-S1, monolith)', () => {
  let isRootMembershipEnabled: jest.SpyInstance

  afterEach(() => {
    isRootMembershipEnabled?.mockRestore()
  })

  it('sanity: root org (ROOT_ORG_ID) exists — seeded by migration 015', async () => {
    const root = await db('organizations').where({ id: ROOT_ORG_ID }).first()
    expect(root).toBeTruthy()
  })

  describe('flag OFF (default) — byte-identical to today', () => {
    it('runInternalProvision still creates a personal org and returns its id', async () => {
      isRootMembershipEnabled = jest
        .spyOn(rootMembershipFlagModule, 'isRootMembershipEnabled')
        .mockResolvedValue(false)

      const userId = await createUser()
      const result = await runInternalProvision(userId, deps())

      expect(result.personalOrgId).toBeTruthy()
      const personal = await db('organizations').where({ id: result.personalOrgId }).first()
      expect(personal.type).toBe('personal')

      const rootMembership = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
        .first()
      expect(rootMembership).toBeUndefined()
    })
  })

  describe('flag ON — root membership, no personal org', () => {
    it('runInternalProvision upserts a root member row and creates NO personal org', async () => {
      isRootMembershipEnabled = jest
        .spyOn(rootMembershipFlagModule, 'isRootMembershipEnabled')
        .mockResolvedValue(true)

      const userId = await createUser()
      const result = await runInternalProvision(userId, deps())

      expect(result.personalOrgId).toBeNull()

      const personalOrgs = await db('organizations').where({ owner_id: userId, type: 'personal' })
      expect(personalOrgs).toHaveLength(0)

      const membership = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
        .first()
      expect(membership).toMatchObject({ role: 'member', status: 'active' })
    })

    it('ensureRootMembership is idempotent — two calls yield exactly one row', async () => {
      const userId = await createUser()

      await ensureRootMembership(userId, { db })
      await ensureRootMembership(userId, { db })

      const rows = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ role: 'member', status: 'active' })
    })

    it('concurrent ensureRootMembership calls yield exactly one row (race safety)', async () => {
      const userId = await createUser()

      await Promise.all([
        ensureRootMembership(userId, { db }),
        ensureRootMembership(userId, { db }),
      ])

      const rows = await db('organization_memberships')
        .where({ user_id: userId, organization_id: ROOT_ORG_ID })
      expect(rows).toHaveLength(1)
    })
  })

  describe('flag ON does not disturb ensurePersonalOrg itself (direct callers unaffected)', () => {
    it('ensurePersonalOrg still creates a personal org when called directly, regardless of the flag', async () => {
      isRootMembershipEnabled = jest
        .spyOn(rootMembershipFlagModule, 'isRootMembershipEnabled')
        .mockResolvedValue(true)
      const userId = await createUser()

      const personal = await ensurePersonalOrg(userId, { db })
      expect(personal.type).toBe('personal')
    })
  })
})
