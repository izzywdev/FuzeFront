/**
 * FF-EPIC-17-S8 — formalizing "Employee" (platform staff = ReBAC
 * org-admin-on-root). Real Postgres for `organization_memberships`, a
 * injected fake for the ReBAC check (no live Permit connection needed) —
 * mirrors tests/root-org-admin.test.ts's DI style.
 */
import { v4 as uuidv4 } from 'uuid'

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: { api: {} },
}))

import { db, initializeDatabaseConnection } from '../src/config/database'
import { ROOT_ORG_ID } from '../src/migrations/015_seed_root_platform_organization'
import {
  EMPLOYEE_USER_ROLE,
  EMPLOYEE_REBAC_ROLE,
  EMPLOYEE_ROLE_CATALOG_ENTRY,
  isEmployeeByUserRoles,
  resolveEmployeeStatus,
} from '../src/services/employeeRole'

beforeAll(() => {
  initializeDatabaseConnection()
})

async function createUser(roles: string[] = ['user']): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `emp-${id.slice(0, 8)}@test.local`,
    first_name: 'Employee',
    last_name: 'Test',
    roles: JSON.stringify(roles),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function createCustomerOrg(): Promise<string> {
  const id = uuidv4()
  const ownerId = await createUser(['user'])
  await db('organizations').insert({
    id,
    name: `Customer Org ${id.slice(0, 8)}`,
    slug: `customer-${id.slice(0, 8)}`,
    type: 'organization',
    owner_id: ownerId,
    settings: JSON.stringify({}),
    metadata: JSON.stringify({}),
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

async function insertMembership(
  userId: string,
  organizationId: string,
  role = 'admin'
): Promise<void> {
  await db('organization_memberships').insert({
    id: uuidv4(),
    user_id: userId,
    organization_id: organizationId,
    role,
    status: 'active',
    joined_at: new Date(),
    permissions: JSON.stringify({}),
    metadata: JSON.stringify({}),
  })
}

describe('isEmployeeByUserRoles (pure predicate)', () => {
  it('true for the explicit `employee` marker', () => {
    expect(isEmployeeByUserRoles(['employee'])).toBe(true)
  })

  it('true for the legacy implicit `admin` marker (back-compat)', () => {
    expect(isEmployeeByUserRoles(['admin', 'user'])).toBe(true)
  })

  it('false for a plain user', () => {
    expect(isEmployeeByUserRoles(['user'])).toBe(false)
  })

  it('false/safe for null, undefined, and malformed JSON strings', () => {
    expect(isEmployeeByUserRoles(null)).toBe(false)
    expect(isEmployeeByUserRoles(undefined)).toBe(false)
    expect(isEmployeeByUserRoles('not-json')).toBe(false)
  })

  it('handles the stringified-JSON shape the roles column may come back as', () => {
    expect(isEmployeeByUserRoles(JSON.stringify(['employee']))).toBe(true)
  })
})

describe('EMPLOYEE_ROLE_CATALOG_ENTRY', () => {
  it('is never assignable via an org membership row (AC4 contract)', () => {
    expect(EMPLOYEE_ROLE_CATALOG_ENTRY.assignable).toBe(false)
    expect(EMPLOYEE_ROLE_CATALOG_ENTRY.key).toBe('employee')
    expect(EMPLOYEE_ROLE_CATALOG_ENTRY.rebacRole).toBe(EMPLOYEE_REBAC_ROLE)
  })
})

describe('resolveEmployeeStatus', () => {
  it('isEmployee=true when the ReBAC root org-admin grant is held (AC1)', async () => {
    const userId = await createUser(['employee'])

    const status = await resolveEmployeeStatus(userId, {
      db,
      hasRootOrgAdminRebac: async () => true,
    })

    expect(status.isEmployee).toBe(true)
    expect(status.roleKey).toBe('employee')
    expect(status.rebacRole).toBe(EMPLOYEE_REBAC_ROLE)
  })

  it('isEmployee=false when the ReBAC grant is absent', async () => {
    const userId = await createUser(['user'])

    const status = await resolveEmployeeStatus(userId, {
      db,
      hasRootOrgAdminRebac: async () => false,
    })

    expect(status.isEmployee).toBe(false)
  })

  // AC2: a pure Employee holds ZERO organization_memberships rows in any
  // customer org — the invariant this story requires as a regression test.
  it('AC2: a pure Employee has zero directOrgMemberships (zero-membership-rows invariant)', async () => {
    const userId = await createUser(['employee'])

    const status = await resolveEmployeeStatus(userId, {
      db,
      hasRootOrgAdminRebac: async () => true,
    })

    expect(status.isEmployee).toBe(true)
    expect(status.directOrgMemberships).toEqual([])
  })

  // AC3: an Employee who is ALSO a direct member of one specific customer
  // org must have BOTH facts surfaced distinctly — never merged into one
  // ambiguous row.
  it('AC3: Employee + direct member of one org are reported distinctly, not merged', async () => {
    const userId = await createUser(['employee'])
    const orgId = await createCustomerOrg()
    await insertMembership(userId, orgId, 'admin')

    const status = await resolveEmployeeStatus(userId, {
      db,
      hasRootOrgAdminRebac: async () => true,
    })

    expect(status.isEmployee).toBe(true)
    expect(status.directOrgMemberships).toEqual([orgId])
  })

  // AC4: Employee status can ONLY be granted via the root ReBAC assignment,
  // never faked by inserting a customer-org membership row. Proven by
  // stubbing the ReBAC check to `false` (no real grant) while a membership
  // row with role='admin' exists — resolveEmployeeStatus must still report
  // isEmployee=false, because the membership table is never consulted to
  // decide isEmployee (see the module's SECURITY INVARIANT doc).
  it('AC4: inserting a customer-org membership row cannot manufacture Employee status', async () => {
    const userId = await createUser(['user'])
    const orgId = await createCustomerOrg()
    await insertMembership(userId, orgId, 'admin')

    const status = await resolveEmployeeStatus(userId, {
      db,
      hasRootOrgAdminRebac: async () => false, // no real ReBAC grant
    })

    expect(status.isEmployee).toBe(false)
    // The membership row is still visible informationally...
    expect(status.directOrgMemberships).toEqual([orgId])
    // ...but never flips isEmployee — proving there is no code path from
    // organization_memberships to isEmployee.
  })

  // A root-org membership row (from FF-EPIC-17-S1's root-membership
  // provisioning) must never be reported as a "customer org" membership.
  it('excludes the ROOT_ORG_ID membership row from directOrgMemberships', async () => {
    const userId = await createUser(['employee'])
    await insertMembership(userId, ROOT_ORG_ID, 'member')

    const status = await resolveEmployeeStatus(userId, {
      db,
      hasRootOrgAdminRebac: async () => true,
    })

    expect(status.directOrgMemberships).toEqual([])
  })
})

describe('EMPLOYEE_USER_ROLE constant', () => {
  it('is the literal string "employee"', () => {
    expect(EMPLOYEE_USER_ROLE).toBe('employee')
  })
})
