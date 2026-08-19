/**
 * FF-EPIC-17-S8 — security-service mirror of backend/tests/employeeRole.test.ts.
 * DB is mocked (no real Postgres required) — matches
 * organizations.members.test.ts's harness style.
 */
import {
  EMPLOYEE_USER_ROLE,
  EMPLOYEE_REBAC_ROLE,
  EMPLOYEE_ROLE_CATALOG_ENTRY,
  isEmployeeByUserRoles,
  resolveEmployeeStatus,
} from '../src/services/employeeRole'
import { ROOT_ORG_ID } from '../src/migrations/014_seed_root_platform_organization'

// Minimal fake knex: db('organization_memberships').where(...).whereNot(...).select(...)
function makeFakeDb(rows: Array<{ organization_id: string }>) {
  const calls: { where?: any; whereNot?: any } = {}
  const chain = {
    where: jest.fn(function (this: any, arg: any) {
      calls.where = arg
      return this
    }),
    whereNot: jest.fn(function (this: any, arg: any) {
      calls.whereNot = arg
      return this
    }),
    select: jest.fn().mockResolvedValue(rows),
  }
  const db = jest.fn().mockReturnValue(chain)
  return { db: db as any, calls, chain }
}

describe('isEmployeeByUserRoles (pure predicate, security mirror)', () => {
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
})

describe('EMPLOYEE_ROLE_CATALOG_ENTRY (security mirror)', () => {
  it('is never assignable via an org membership row (AC4 contract)', () => {
    expect(EMPLOYEE_ROLE_CATALOG_ENTRY.assignable).toBe(false)
    expect(EMPLOYEE_ROLE_CATALOG_ENTRY.key).toBe('employee')
    expect(EMPLOYEE_ROLE_CATALOG_ENTRY.rebacRole).toBe(EMPLOYEE_REBAC_ROLE)
  })
})

describe('EMPLOYEE_USER_ROLE constant (security mirror — same marker as the monolith)', () => {
  it('is the literal string "employee"', () => {
    expect(EMPLOYEE_USER_ROLE).toBe('employee')
  })
})

describe('resolveEmployeeStatus (security mirror, mocked db)', () => {
  const USER_ID = 'user-1'

  it('isEmployee=true when the ReBAC root org-admin grant is held (AC1)', async () => {
    const { db } = makeFakeDb([])

    const status = await resolveEmployeeStatus(USER_ID, {
      db,
      hasRootOrgAdminRebac: async () => true,
    })

    expect(status.isEmployee).toBe(true)
    expect(status.roleKey).toBe('employee')
    expect(status.rebacRole).toBe(EMPLOYEE_REBAC_ROLE)
  })

  it('isEmployee=false when the ReBAC grant is absent', async () => {
    const { db } = makeFakeDb([])

    const status = await resolveEmployeeStatus(USER_ID, {
      db,
      hasRootOrgAdminRebac: async () => false,
    })

    expect(status.isEmployee).toBe(false)
  })

  // AC2: a pure Employee holds ZERO organization_memberships rows in any
  // customer org.
  it('AC2: a pure Employee has zero directOrgMemberships (zero-membership-rows invariant)', async () => {
    const { db } = makeFakeDb([])

    const status = await resolveEmployeeStatus(USER_ID, {
      db,
      hasRootOrgAdminRebac: async () => true,
    })

    expect(status.isEmployee).toBe(true)
    expect(status.directOrgMemberships).toEqual([])
  })

  // AC3: Employee + direct member of one org are reported distinctly.
  it('AC3: Employee + direct member of one org are reported distinctly, not merged', async () => {
    const { db } = makeFakeDb([{ organization_id: 'org-42' }])

    const status = await resolveEmployeeStatus(USER_ID, {
      db,
      hasRootOrgAdminRebac: async () => true,
    })

    expect(status.isEmployee).toBe(true)
    expect(status.directOrgMemberships).toEqual(['org-42'])
  })

  // AC4: a customer-org membership row can never manufacture Employee status
  // — the fake db returns a membership row, but hasRootOrgAdminRebac (the
  // ONLY source of truth for isEmployee) says false.
  it('AC4: a customer-org membership row cannot manufacture Employee status', async () => {
    const { db } = makeFakeDb([{ organization_id: 'org-42' }])

    const status = await resolveEmployeeStatus(USER_ID, {
      db,
      hasRootOrgAdminRebac: async () => false,
    })

    expect(status.isEmployee).toBe(false)
    expect(status.directOrgMemberships).toEqual(['org-42'])
  })

  it('excludes ROOT_ORG_ID from the customer-org membership query (whereNot)', async () => {
    const { db, calls } = makeFakeDb([])

    await resolveEmployeeStatus(USER_ID, {
      db,
      hasRootOrgAdminRebac: async () => true,
    })

    expect(calls.where).toMatchObject({ user_id: USER_ID })
    expect(calls.whereNot).toMatchObject({ organization_id: ROOT_ORG_ID })
  })
})
