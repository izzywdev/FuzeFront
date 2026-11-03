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
  isPersonalContextOrg,
  isSwitcherContextOrg,
} from '../orgMembership'

const org = (o: Partial<Organization>): Organization => ({ id: 'org_x', name: 'X', ...o })

// Fixtures for the migration-025 collision case: a genuine type='personal' org
// AND a distinct over-reclassified org (type='organization' + metadata.personal).
const genuinePersonal = org({ id: 'org_genuine', type: 'personal', user_role: 'owner' })
const overReclassified = org({
  id: 'org_ovr',
  type: 'organization',
  user_role: 'owner',
  metadata: { personal: true },
})

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

describe('isPersonalContextOrg', () => {
  it('is true for a genuine type=personal org', () => {
    expect(isPersonalContextOrg(genuinePersonal, [genuinePersonal])).toBe(true)
  })

  it('is true for a lone over-reclassified org (the only personal representation)', () => {
    const list = [overReclassified, org({ id: 'org_acme', type: 'organization', user_role: 'member' })]
    expect(isPersonalContextOrg(overReclassified, list)).toBe(true)
  })

  it('is FALSE for an over-reclassified org when a genuine type=personal sibling exists', () => {
    // Collision case (025 skip): the over-reclassified org is a distinct tenant
    // that must stay selectable, not be swallowed into the null Personal context.
    const list = [genuinePersonal, overReclassified]
    expect(isPersonalContextOrg(overReclassified, list)).toBe(false)
    // The genuine personal org is still the Personal context.
    expect(isPersonalContextOrg(genuinePersonal, list)).toBe(true)
  })

  it('is false for a regular org and a real org merely named "Personal"', () => {
    const list = [org({ type: 'organization', name: 'Personal' })]
    expect(isPersonalContextOrg(list[0], list)).toBe(false)
  })
})

describe('isSwitcherContextOrg', () => {
  it('drops a correctly-typed personal org', () => {
    const o = org({ type: 'personal', user_role: 'owner' })
    expect(isSwitcherContextOrg(o, [o])).toBe(false)
  })

  it('drops a lone over-reclassified personal org even though it is a real membership', () => {
    expect(isSwitcherContextOrg(overReclassified, [overReclassified])).toBe(false)
  })

  it('KEEPS an over-reclassified org when a genuine personal sibling exists (distinct tenant)', () => {
    const list = [genuinePersonal, overReclassified]
    expect(isSwitcherContextOrg(overReclassified, list)).toBe(true)
    // ...while the genuine personal org is still dropped.
    expect(isSwitcherContextOrg(genuinePersonal, list)).toBe(false)
  })

  it('keeps a real organization membership', () => {
    const o = org({ type: 'organization', user_role: 'owner' })
    expect(isSwitcherContextOrg(o, [o])).toBe(true)
  })

  it('drops a visibility-only platform org (GUEST, user_role null)', () => {
    const o = org({ type: 'platform', user_role: null })
    expect(isSwitcherContextOrg(o, [o])).toBe(false)
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
