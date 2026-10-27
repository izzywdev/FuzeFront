/**
 * orgMembership — switcher-eligibility predicates.
 *
 * The regression this file guards: an over-reclassified personal org (migration
 * 022 flipped `type='personal' -> 'organization'` but left `metadata.personal`
 * intact) must still be treated as the personal workspace, so the reconciled
 * context switcher drops it instead of painting a second "Personal [OWNER]" row
 * beside the first-class Personal context.
 */
import { describe, it, expect } from 'vitest'
import type { Organization } from '../../services/api'
import {
  isProvisionedMembership,
  isPersonalWorkspaceOrg,
  isSwitcherContextOrg,
} from '../orgMembership'

const org = (o: Partial<Organization>): Organization => ({ id: 'org_x', name: 'X', ...o })

describe('isPersonalWorkspaceOrg', () => {
  it('is true for a correctly-typed personal org', () => {
    expect(isPersonalWorkspaceOrg(org({ type: 'personal' }))).toBe(true)
  })

  it('is true for an over-reclassified personal org (type organization, metadata.personal)', () => {
    expect(
      isPersonalWorkspaceOrg(org({ type: 'organization', metadata: { personal: true } }))
    ).toBe(true)
  })

  it('is false for a regular organization', () => {
    expect(isPersonalWorkspaceOrg(org({ type: 'organization' }))).toBe(false)
  })

  it('is false for a real org that merely happens to be named "Personal"', () => {
    // No personal marker in metadata — a user-created org named Personal is a
    // legitimate switch target and must NOT be dropped.
    expect(isPersonalWorkspaceOrg(org({ type: 'organization', name: 'Personal' }))).toBe(false)
  })
})

describe('isSwitcherContextOrg', () => {
  it('drops a correctly-typed personal org', () => {
    expect(isSwitcherContextOrg(org({ type: 'personal', user_role: 'owner' }))).toBe(false)
  })

  it('drops an over-reclassified personal org even though it is a real membership', () => {
    expect(
      isSwitcherContextOrg(
        org({ type: 'organization', user_role: 'owner', metadata: { personal: true } })
      )
    ).toBe(false)
  })

  it('keeps a real organization membership', () => {
    expect(isSwitcherContextOrg(org({ type: 'organization', user_role: 'owner' }))).toBe(true)
  })

  it('drops a visibility-only platform org (GUEST, user_role null)', () => {
    expect(isSwitcherContextOrg(org({ type: 'platform', user_role: null }))).toBe(false)
  })
})

describe('isProvisionedMembership', () => {
  it('uses user_role when present — an explicit null beats type', () => {
    // user_role !== undefined, so the user_role branch is taken and the type
    // check is never reached: null != null is false → not a member. Fixtures
    // carry an explicit type to make it unambiguous that user_role wins over it.
    expect(isProvisionedMembership(org({ type: 'platform', user_role: 'owner' }))).toBe(true)
    expect(isProvisionedMembership(org({ type: 'organization', user_role: null }))).toBe(false)
  })

  it('falls back to excluding platform orgs when user_role is absent (undefined)', () => {
    // No user_role key at all → user_role === undefined → type branch.
    expect(isProvisionedMembership(org({ type: 'platform' }))).toBe(false)
    expect(isProvisionedMembership(org({ type: 'organization' }))).toBe(true)
  })
})
