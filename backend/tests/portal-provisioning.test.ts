import { v4 as uuidv4 } from 'uuid'

// Avoid importing the real Permit SDK (which requires PERMIT_API_KEY at import
// time). Every test here injects a fake PortalProvisioningPermitClient, so the
// default client built on config/permit is never exercised — same convention
// as tests/provisioning.test.ts.
jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import { db, initializeDatabaseConnection } from '../src/config/database'
import {
  provisionPortal,
  SlugTakenError,
  PORTAL_PROVISIONING_STEPS,
  PortalProvisioningDeps,
  PortalProvisioningPermitClient,
  PortalCreateInput,
} from '../src/services/portalProvisioning'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'

// ---- fakes -------------------------------------------------------------

function makeFakePermit(
  overrides: Partial<PortalProvisioningPermitClient> = {}
): PortalProvisioningPermitClient & {
  calls: Record<string, number>
  parentLinks: Array<{ child: string; parent: string }>
} {
  const calls = { createTenant: 0, createOrgInstance: 0, linkParent: 0 }
  const parentLinks: Array<{ child: string; parent: string }> = []
  return {
    calls,
    parentLinks,
    async createTenant() {
      calls.createTenant++
    },
    async createOrgInstance() {
      calls.createOrgInstance++
    },
    async linkParent(org: any, parentOrgId: string) {
      calls.linkParent++
      parentLinks.push({ child: org.id, parent: parentOrgId })
    },
    ...overrides,
  } as any
}

function makeFakePublisher() {
  const emails: any[] = []
  const portalCreatedEvents: any[] = []
  return {
    emails,
    portalCreatedEvents,
    publisher: {
      async publishIdentityUserCreated() {},
      async publishNotifyEmailRequested(payload: any) {
        emails.push(payload)
      },
      async publishPortalCreated(payload: any) {
        portalCreatedEvents.push(payload)
      },
    },
  }
}

beforeAll(() => {
  initializeDatabaseConnection()
})

function deps(permit: any, publish: any): Partial<PortalProvisioningDeps> {
  return { db, permit, publish }
}

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `portal-prov-${id.slice(0, 8)}@test.local`,
    first_name: 'Portal',
    last_name: 'Prov',
    roles: JSON.stringify(['admin']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

function uniqueSlug(prefix: string): string {
  return `${prefix}-${uuidv4().slice(0, 8)}`
}

function makeInput(overrides: Partial<PortalCreateInput> = {}): PortalCreateInput {
  return {
    name: 'Acme Corp',
    slug: uniqueSlug('acme'),
    ownerEmail: 'owner@acme.example.com',
    ...overrides,
  }
}

// ---- tests ---------------------------------------------------------------

describe('provisionPortal — happy path', () => {
  it('creates org, Permit tenant/instance/parent-link, portal row, default subdomain, and owner invite', async () => {
    const actorId = await createUser()
    const permit = makeFakePermit()
    const { publisher, emails, portalCreatedEvents } = makeFakePublisher()
    const input = makeInput()

    const result = await provisionPortal(input, actorId, deps(permit, publisher))

    expect(result.ok).toBe(true)
    expect(result.resumed).toBe(false)
    expect(result.portal).toBeTruthy()
    expect(result.portal!.slug).toBe(input.slug)
    expect(result.portal!.status).toBe('provisioned-pending-invite')
    expect(result.portal!.ownerEmail).toBe(input.ownerEmail)
    expect(result.portal!.isRoot).toBe(false)

    // Default subdomain, auto-verified.
    expect(result.portal!.domains).toHaveLength(1)
    const domain = result.portal!.domains[0]
    expect(domain.domain).toBe(`${input.slug}.fuzefront.com`)
    expect(domain.kind).toBe('subdomain')
    expect(domain.isPrimary).toBe(true)
    expect((domain as any).active).toBe(true)
    expect(result.portal!.primaryDomain).toBe(`${input.slug}.fuzefront.com`)

    // Underlying organization.
    const org = await db('organizations').where({ id: result.portal!.organizationId }).first()
    expect(org).toBeTruthy()
    expect(org.parent_id).toBe(ROOT_ORG_ID)
    expect(org.type).toBe('organization')
    expect(org.owner_id).toBe(actorId)

    // Permit steps.
    expect(permit.calls).toEqual({ createTenant: 1, createOrgInstance: 1, linkParent: 1 })
    expect(permit.parentLinks).toEqual([{ child: org.id, parent: ROOT_ORG_ID }])

    // Owner invite.
    expect(emails).toHaveLength(1)
    expect(emails[0].template).toBe('org-invite')
    expect(emails[0].to).toBe(input.ownerEmail)
    const invitation = await db('organization_invitations')
      .where({ organization_id: org.id, email: input.ownerEmail })
      .first()
    expect(invitation).toBeTruthy()
    expect(invitation.role).toBe('owner')
    expect(invitation.status).toBe('pending')

    // portal.created event — both the live publish AND the durable outbox record.
    expect(portalCreatedEvents).toHaveLength(1)
    expect(portalCreatedEvents[0]).toMatchObject({
      portalId: result.portal!.id,
      slug: input.slug,
      organizationId: org.id,
      ownerEmail: input.ownerEmail,
      status: 'provisioned-pending-invite',
    })
    const outboxRow = await db('event_outbox').where({ topic: 'portal.created' }).andWhereRaw(
      `payload->>'slug' = ?`,
      [input.slug]
    ).first()
    expect(outboxRow).toBeTruthy()

    // Every step recorded done.
    const steps = await db('portal_provisioning').where({ slug: input.slug })
    expect(steps).toHaveLength(PORTAL_PROVISIONING_STEPS.length)
    expect(steps.every((s: any) => s.status === 'done')).toBe(true)
  })

  it('applies caller-supplied branding/identityPolicy/billingMode over the defaults', async () => {
    const actorId = await createUser()
    const permit = makeFakePermit()
    const { publisher } = makeFakePublisher()
    const input = makeInput({
      billingMode: 'reseller',
      branding: { name: 'Acme Corp', accent: '#ff0000' },
      identityPolicy: { allowPasswordLogin: false, allowSelfSignup: true },
    })

    const result = await provisionPortal(input, actorId, deps(permit, publisher))

    expect(result.ok).toBe(true)
    expect(result.portal!.billingMode).toBe('reseller')
    expect(result.portal!.branding.accent).toBe('#ff0000')
    expect(result.portal!.identityPolicy.allowPasswordLogin).toBe(false)
    expect(result.portal!.identityPolicy.allowSelfSignup).toBe(true)
  })
})

describe('provisionPortal — AC2: resumable after a mid-step failure', () => {
  it('resumes from the failed step on retrigger, without re-creating prior resources', async () => {
    const actorId = await createUser()
    const { publisher, emails } = makeFakePublisher()
    const input = makeInput()

    let failInstance = true
    const permit = makeFakePermit({
      async createOrgInstance() {
        permit.calls.createOrgInstance++
        if (failInstance) throw new Error('permit outage 500')
      },
    })

    const first = await provisionPortal(input, actorId, deps(permit, publisher))
    expect(first.ok).toBe(false)
    expect(first.resumed).toBe(false)
    expect(first.failedStep).toBe('permit_org_instance')
    // No portal row exists yet — failure happened before step 5.
    expect(first.portal).toBeNull()

    // Prior steps recorded done; the org itself DOES already exist.
    const orgStep = await db('portal_provisioning')
      .where({ slug: input.slug, step: 'org_create' })
      .first()
    expect(orgStep.status).toBe('done')
    const tenantStep = await db('portal_provisioning')
      .where({ slug: input.slug, step: 'permit_tenant_create' })
      .first()
    expect(tenantStep.status).toBe('done')
    const instanceStep = await db('portal_provisioning')
      .where({ slug: input.slug, step: 'permit_org_instance' })
      .first()
    expect(instanceStep.status).toBe('failed')
    expect(instanceStep.last_error).toContain('permit outage 500')

    const orgCountAfterFirst = await db('organizations')
      .whereRaw(`metadata->>'portalSlug' = ?`, [input.slug])
      .count<{ c: string }[]>('* as c')
    expect(Number(orgCountAfterFirst[0].c)).toBe(1)

    // Fix the outage and retrigger with the SAME input — a resume.
    failInstance = false
    const second = await provisionPortal(input, actorId, deps(permit, publisher))
    expect(second.ok).toBe(true)
    expect(second.resumed).toBe(true)
    expect(second.portal!.slug).toBe(input.slug)

    // org_create / permit_tenant_create were NOT re-run.
    expect(permit.calls.createTenant).toBe(1)
    const orgCountAfterSecond = await db('organizations')
      .whereRaw(`metadata->>'portalSlug' = ?`, [input.slug])
      .count<{ c: string }[]>('* as c')
    expect(Number(orgCountAfterSecond[0].c)).toBe(1)

    // Every step is now done, exactly once each row.
    const steps = await db('portal_provisioning').where({ slug: input.slug })
    expect(steps).toHaveLength(PORTAL_PROVISIONING_STEPS.length)
    expect(steps.every((s: any) => s.status === 'done')).toBe(true)

    // The invite was only sent once, on the resumed (successful) call.
    expect(emails).toHaveLength(1)
  })
})

describe('provisionPortal — AC3: concurrent same-slug requests serialize', () => {
  it('exactly one call succeeds; the other is rejected with SlugTakenError', async () => {
    const actorId = await createUser()
    const input = makeInput()

    const permitA = makeFakePermit()
    const permitB = makeFakePermit()
    const { publisher: publisherA } = makeFakePublisher()
    const { publisher: publisherB } = makeFakePublisher()

    const results = await Promise.allSettled([
      provisionPortal(input, actorId, deps(permitA, publisherA)),
      provisionPortal(input, actorId, deps(permitB, publisherB)),
    ])

    const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[]
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]

    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0].value.ok).toBe(true)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(SlugTakenError)

    // Only ONE organization + ONE full step ledger were ever created for this slug.
    const orgCount = await db('organizations')
      .whereRaw(`metadata->>'portalSlug' = ?`, [input.slug])
      .count<{ c: string }[]>('* as c')
    expect(Number(orgCount[0].c)).toBe(1)
    const steps = await db('portal_provisioning').where({ slug: input.slug })
    expect(steps).toHaveLength(PORTAL_PROVISIONING_STEPS.length)

    const totalTenantCalls = permitA.calls.createTenant + permitB.calls.createTenant
    expect(totalTenantCalls).toBe(1)

    const portalCount = await db('portals').where({ slug: input.slug }).count<{ c: string }[]>('* as c')
    expect(Number(portalCount[0].c)).toBe(1)
  })
})

describe('provisionPortal — AC4: owner-invite failure never regresses status, still emits portal.created', () => {
  it('leaves the portal provisioned-pending-invite (never silently active) and still emits portal.created', async () => {
    const actorId = await createUser()
    const permit = makeFakePermit()
    const { publisher, portalCreatedEvents } = makeFakePublisher()
    publisher.publishNotifyEmailRequested = async () => {
      throw new Error('email provider outage')
    }
    const input = makeInput()

    const result = await provisionPortal(input, actorId, deps(permit, publisher))

    expect(result.ok).toBe(true)
    expect(result.portal!.status).toBe('provisioned-pending-invite')

    const inviteStep = await db('portal_provisioning')
      .where({ slug: input.slug, step: 'owner_invite' })
      .first()
    expect(inviteStep.status).toBe('failed')
    expect(inviteStep.last_error).toContain('email provider outage')

    // The invitation row itself is still recorded (independently retryable).
    const invitation = await db('organization_invitations')
      .where({ organization_id: result.portal!.organizationId, email: input.ownerEmail })
      .first()
    expect(invitation).toBeTruthy()

    // portal.created still fires even though the invite step failed.
    expect(portalCreatedEvents).toHaveLength(1)
    const outboxRow = await db('event_outbox')
      .where({ topic: 'portal.created' })
      .andWhereRaw(`payload->>'slug' = ?`, [input.slug])
      .first()
    expect(outboxRow).toBeTruthy()
  })
})

describe('provisionPortal — genuine duplicate slug', () => {
  it('rejects a fresh create for a slug that already resolved to a non-provisioning portal', async () => {
    const actorId = await createUser()
    const permit = makeFakePermit()
    const { publisher } = makeFakePublisher()
    const input = makeInput()

    const first = await provisionPortal(input, actorId, deps(permit, publisher))
    expect(first.ok).toBe(true)

    // Simulate the portal reaching a later lifecycle state (e.g. invite
    // accepted -> active, or master-admin suspended it).
    await db('portals').where({ id: first.portal!.id }).update({ status: 'active' })

    await expect(
      provisionPortal(input, actorId, deps(makeFakePermit(), makeFakePublisher().publisher))
    ).rejects.toBeInstanceOf(SlugTakenError)
  })
})
