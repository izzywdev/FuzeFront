import { v4 as uuidv4 } from 'uuid'

// Avoid importing the real Permit SDK (which requires PERMIT_API_KEY at import
// time). These tests inject fake Permit clients, so the default client built on
// config/permit is never exercised.
jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import { db, initializeDatabaseConnection } from '../src/config/database'
import {
  ensurePersonalOrg,
  reconcileOrganizationProvisioning,
  runInternalProvision,
  PROVISIONING_STEPS,
  ProvisioningDeps,
  ProvisioningPermitClient,
} from '../src/services/organizationProvisioning'
import {
  createTenantInPermit,
  isAlreadyExistsError,
} from '../src/utils/permit/tenant-management'
import { Organization } from '../src/types/shared'

// ---- fakes -------------------------------------------------------------

function makeFakePermit(
  overrides: Partial<ProvisioningPermitClient> = {}
): ProvisioningPermitClient & { calls: Record<string, number> } {
  const calls = { syncUser: 0, createTenant: 0, assignOwnerRole: 0 }
  return {
    calls,
    async syncUser() {
      calls.syncUser++
    },
    async createTenant() {
      calls.createTenant++
    },
    async assignOwnerRole() {
      calls.assignOwnerRole++
    },
    ...overrides,
  } as any
}

function makeFakePublisher() {
  const emails: any[] = []
  return {
    emails,
    publisher: {
      async publishIdentityUserCreated() {},
      async publishNotifyEmailRequested(payload: any) {
        emails.push(payload)
      },
    },
  }
}

// Global setup runs migrations/seeds but does not open the runtime connection.
beforeAll(() => {
  initializeDatabaseConnection()
})

function deps(permit: any, publish: any): Partial<ProvisioningDeps> {
  return { db, permit, publish }
}

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `prov-${id.slice(0, 8)}@test.local`,
    first_name: 'Prov',
    last_name: 'Test',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createOrg(ownerId: string, type = 'organization'): Promise<string> {
  const id = uuidv4()
  await db('organizations').insert({
    id,
    name: 'Acme',
    slug: `acme-${id.slice(0, 8)}`,
    owner_id: ownerId,
    type,
    settings: JSON.stringify({}),
    metadata: JSON.stringify({}),
    is_active: true,
    provisioning_state: 'pending',
  })
  return id
}

// ---- tests -------------------------------------------------------------

describe('ensurePersonalOrg', () => {
  it('is idempotent — two calls yield exactly one personal org', async () => {
    const userId = await createUser()

    const first = await ensurePersonalOrg(userId, { db })
    const second = await ensurePersonalOrg(userId, { db })

    expect(first.id).toBe(second.id)
    expect(first.type).toBe('personal')

    const count = await db('organizations')
      .where({ owner_id: userId, type: 'personal' })
      .count<{ c: string }[]>('* as c')
    expect(Number(count[0].c)).toBe(1)

    // Owner membership exists.
    const membership = await db('organization_memberships')
      .where({ organization_id: first.id, user_id: userId, role: 'owner' })
      .first()
    expect(membership).toBeTruthy()
  })
})

describe('reconcileOrganizationProvisioning', () => {
  it('runs all steps, marks org active, and publishes a welcome email', async () => {
    const userId = await createUser()
    const orgId = await createOrg(userId)
    const permit = makeFakePermit()
    const { publisher, emails } = makeFakePublisher()

    const state = await reconcileOrganizationProvisioning(
      orgId,
      deps(permit, publisher)
    )

    expect(state).toBe('active')
    expect(permit.calls).toEqual({
      syncUser: 1,
      createTenant: 1,
      assignOwnerRole: 1,
    })
    expect(emails).toHaveLength(1)
    expect(emails[0].template).toBe('welcome')

    const org = await db('organizations').where({ id: orgId }).first()
    expect(org.provisioning_state).toBe('active')

    const steps = await db('organization_provisioning').where({
      organization_id: orgId,
    })
    expect(steps).toHaveLength(PROVISIONING_STEPS.length)
    expect(steps.every((s: any) => s.status === 'done')).toBe(true)
  })

  it('is resumable — a re-run skips done steps', async () => {
    const userId = await createUser()
    const orgId = await createOrg(userId)
    const permit = makeFakePermit()
    const { publisher } = makeFakePublisher()

    await reconcileOrganizationProvisioning(orgId, deps(permit, publisher))
    // Second run should not re-invoke any Permit step.
    await reconcileOrganizationProvisioning(orgId, deps(permit, publisher))

    expect(permit.calls).toEqual({
      syncUser: 1,
      createTenant: 1,
      assignOwnerRole: 1,
    })
  })

  it('records a failed step + last_error, and a later run retries it', async () => {
    const userId = await createUser()
    const orgId = await createOrg(userId)
    const { publisher } = makeFakePublisher()

    let failTenant = true
    const permit = makeFakePermit({
      async createTenant() {
        if (failTenant) throw new Error('permit boom 500')
      },
    })

    const state1 = await reconcileOrganizationProvisioning(
      orgId,
      deps(permit, publisher)
    )
    expect(state1).toBe('failed')

    const tenantStep = await db('organization_provisioning')
      .where({ organization_id: orgId, step: 'permit_tenant_create' })
      .first()
    expect(tenantStep.status).toBe('failed')
    expect(tenantStep.last_error).toContain('permit boom 500')
    expect(tenantStep.attempts).toBe(1)

    // user_sync (a prior step) must already be done; later steps not yet run.
    const userStep = await db('organization_provisioning')
      .where({ organization_id: orgId, step: 'permit_user_sync' })
      .first()
    expect(userStep.status).toBe('done')
    const roleStep = await db('organization_provisioning')
      .where({ organization_id: orgId, step: 'permit_role_assign' })
      .first()
    expect(roleStep.status).toBe('pending')

    // Now let the tenant step succeed; re-run should heal to active and bump attempts.
    failTenant = false
    const state2 = await reconcileOrganizationProvisioning(
      orgId,
      deps(permit, publisher)
    )
    expect(state2).toBe('active')

    const tenantStep2 = await db('organization_provisioning')
      .where({ organization_id: orgId, step: 'permit_tenant_create' })
      .first()
    expect(tenantStep2.status).toBe('done')
    expect(tenantStep2.attempts).toBe(2)
    // user_sync should NOT have been retried.
    expect(permit.calls.syncUser).toBe(1)
  })
})

describe('createTenantInPermit benign-409 handling', () => {
  it('treats a 409 as success and rethrows a real failure', () => {
    expect(isAlreadyExistsError({ status: 409 })).toBe(true)
    expect(isAlreadyExistsError(new Error('Tenant already exists'))).toBe(true)
    expect(isAlreadyExistsError({ response: { status: 409 } })).toBe(true)
    expect(isAlreadyExistsError({ status: 500 })).toBe(false)
    expect(isAlreadyExistsError(new Error('network down'))).toBe(false)
  })
})

describe('runInternalProvision (reconcile-on-login self-heal)', () => {
  it('creates a missing personal org and reconciles owned non-active orgs', async () => {
    const userId = await createUser()
    // user owns one non-active org and has no personal org yet.
    const orgId = await createOrg(userId)
    const permit = makeFakePermit()
    const { publisher } = makeFakePublisher()

    const result = await runInternalProvision(userId, deps(permit, publisher))

    expect(result.personalOrgId).toBeTruthy()
    // both the personal org and the existing org got reconciled to active.
    const states = result.reconciled.map(r => r.state)
    expect(states.every(s => s === 'active')).toBe(true)

    const personal = await db('organizations')
      .where({ id: result.personalOrgId })
      .first()
    expect(personal.type).toBe('personal')
    expect(personal.provisioning_state).toBe('active')

    const acme = await db('organizations').where({ id: orgId }).first()
    expect(acme.provisioning_state).toBe('active')
  })

  it('heals an org left in failed/incomplete state', async () => {
    const userId = await createUser()
    const orgId = await createOrg(userId)
    const { publisher } = makeFakePublisher()

    // First pass fails at tenant create.
    let fail = true
    const permit = makeFakePermit({
      async createTenant() {
        if (fail) throw new Error('temporary outage')
      },
    })
    await reconcileOrganizationProvisioning(orgId, deps(permit, publisher))
    let acme = await db('organizations').where({ id: orgId }).first()
    expect(acme.provisioning_state).toBe('failed')

    // Login self-heal succeeds.
    fail = false
    await runInternalProvision(userId, deps(permit, publisher))
    acme = await db('organizations').where({ id: orgId }).first()
    expect(acme.provisioning_state).toBe('active')
  })
})
