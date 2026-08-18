/**
 * Unit tests for security/repositories/organizationRepository.ts — step 3 of
 * FFRNT-185.
 *
 * Verifies that:
 * - All functions accept EntityId<T> and call the DB with the native UUID
 *   (not the TypeID wire form). Storage contract: uuid column, TypeID on wire.
 * - Slug and email-based lookups use raw strings (no assertRef needed).
 *
 * All DB calls are intercepted via a mock knex builder — no real Postgres.
 */

import { fromUuid } from '@izzywdev/fuzefront-identity'
import {
  findOrgById,
  findOrgBySlug,
  findMembershipById,
  findMembershipByUserAndOrg,
  listOrgMemberships,
  findInvitationById,
  listOrgInvitations,
} from '../src/repositories/organizationRepository'

// ── knex mock factory ──────────────────────────────────────────────────────────
// Each call to makeDb() returns a minimal Knex-like builder stub. We capture
// the `where` arguments and control what `.first()` returns.
// Use NOT_FOUND sentinel because `makeDb(NOT_FOUND)` triggers JS default param.

const NOT_FOUND = Symbol('NOT_FOUND')

function makeDb(returnValue: any = { id: 'some-uuid', name: 'Acme' }) {
  // Resolve the sentinel to `undefined` so `.first()` returns undefined (knex
  // returns undefined when no row matches, not null).
  const resolvedReturn = returnValue === NOT_FOUND ? undefined : returnValue
  const captured: { table?: string; where?: any; orderBy?: any[] } = {}

  const builder: any = {
    where(args: any) {
      captured.where = args
      return builder
    },
    orderBy(...args: any[]) {
      captured.orderBy = args
      return builder
    },
    first() {
      return Promise.resolve(resolvedReturn)
    },
    then(resolve: any) {
      return Promise.resolve([resolvedReturn]).then(resolve)
    },
    // Support bare `await db('table').where(...).orderBy(...)` → array return
    [Symbol.iterator]() {
      return [resolvedReturn][Symbol.iterator]()
    },
  }

  const db: any = (table: string) => {
    captured.table = table
    return builder
  }
  db._captured = captured
  return db
}

// Representative UUIDs for tests (v4 format).
const ORG_UUID = '0195a8f2-6c3d-7000-b000-000000000001'
const USER_UUID = '0195a8f2-6c3d-7000-b000-000000000002'
const MEMBERSHIP_UUID = '0195a8f2-6c3d-7000-b000-000000000003'
const INVITATION_UUID = '0195a8f2-6c3d-7000-b000-000000000004'

// Brand the UUIDs for typed calls (dual-accept window: fromUuid works in test
// env because configureIdentity is not required to call fromUuid).
const ORG_ID = fromUuid('organization', ORG_UUID)
const USER_ID = fromUuid('user', USER_UUID)
const MEMBERSHIP_ID = fromUuid('membership', MEMBERSHIP_UUID)
const INVITATION_ID = fromUuid('invitation', INVITATION_UUID)

describe('findOrgById', () => {
  it('queries organizations table by native UUID (not TypeID)', async () => {
    const db = makeDb({ id: ORG_UUID, name: 'Acme' })
    await findOrgById(ORG_ID, db)
    expect(db._captured.table).toBe('organizations')
    expect(db._captured.where).toEqual({ id: ORG_UUID })
  })

  it('returns the row from the DB', async () => {
    const row = { id: ORG_UUID, name: 'Acme', slug: 'acme' }
    const db = makeDb(row)
    const result = await findOrgById(ORG_ID, db)
    expect(result).toEqual(row)
  })

  it('returns undefined when not found', async () => {
    const db = makeDb(NOT_FOUND)
    const result = await findOrgById(ORG_ID, db)
    expect(result).toBeUndefined()
  })
})

describe('findOrgBySlug', () => {
  it('queries organizations table by slug string (no entity id involved)', async () => {
    const db = makeDb({ id: ORG_UUID, slug: 'acme' })
    await findOrgBySlug('acme', db)
    expect(db._captured.table).toBe('organizations')
    expect(db._captured.where).toEqual({ slug: 'acme' })
  })
})

describe('findMembershipById', () => {
  it('queries organization_memberships by native UUID', async () => {
    const db = makeDb({ id: MEMBERSHIP_UUID })
    await findMembershipById(MEMBERSHIP_ID, db)
    expect(db._captured.table).toBe('organization_memberships')
    expect(db._captured.where).toEqual({ id: MEMBERSHIP_UUID })
  })
})

describe('findMembershipByUserAndOrg', () => {
  it('queries organization_memberships with both UUIDs', async () => {
    const db = makeDb({ id: MEMBERSHIP_UUID })
    await findMembershipByUserAndOrg(USER_ID, ORG_ID, db)
    expect(db._captured.table).toBe('organization_memberships')
    expect(db._captured.where).toEqual({
      user_id: USER_UUID,
      organization_id: ORG_UUID,
    })
  })

  it('uses UUIDs, not TypeID wire forms', async () => {
    const db = makeDb()
    await findMembershipByUserAndOrg(USER_ID, ORG_ID, db)
    const { where } = db._captured
    expect(where.user_id).not.toMatch(/^usr_/)
    expect(where.organization_id).not.toMatch(/^org_/)
  })
})

describe('listOrgMemberships', () => {
  it('queries organization_memberships with org UUID and status active', async () => {
    // The builder's then() resolve with an array; simulate array return.
    const db = makeDb()
    // Override then to return array for list calls
    db('organization_memberships').then = (resolve: any) =>
      Promise.resolve([{ id: MEMBERSHIP_UUID }]).then(resolve)

    await listOrgMemberships(ORG_ID, db)
    expect(db._captured.table).toBe('organization_memberships')
    expect(db._captured.where).toEqual({
      organization_id: ORG_UUID,
      status: 'active',
    })
  })
})

describe('findInvitationById', () => {
  it('queries organization_invitations by native UUID', async () => {
    const db = makeDb({ id: INVITATION_UUID })
    await findInvitationById(INVITATION_ID, db)
    expect(db._captured.table).toBe('organization_invitations')
    expect(db._captured.where).toEqual({ id: INVITATION_UUID })
  })
})

describe('listOrgInvitations', () => {
  it('queries organization_invitations with org UUID and pending status', async () => {
    const db = makeDb()
    await listOrgInvitations(ORG_ID, db)
    expect(db._captured.table).toBe('organization_invitations')
    expect(db._captured.where).toEqual({
      organization_id: ORG_UUID,
      status: 'pending',
    })
  })
})

// ── type-safety smoke test (compile-time, verified by tsc) ───────────────────
// These checks run at compile time in `tsc --noEmit`. The test below documents
// them but does not add a runtime assertion (the TS types catch the issue at
// build time, not at runtime via Jest).
describe('EntityId<T> branded type enforcement (compile-time)', () => {
  it('fromUuid returns a branded EntityId accepted by typed functions', async () => {
    // This line type-checks: fromUuid('organization', ORG_UUID) → EntityId<'organization'>
    const orgId = fromUuid('organization', ORG_UUID)
    const db = makeDb({ id: ORG_UUID })
    // If tsc is satisfied, the branded type is enforced.
    await expect(findOrgById(orgId, db)).resolves.toBeDefined()
  })
})
