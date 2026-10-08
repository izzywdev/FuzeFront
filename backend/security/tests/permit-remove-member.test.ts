/**
 * removeMember must revoke INSTANCE-scoped role assignments too.
 *
 * Permit keys an assignment by (user, role, tenant, resource_instance), so an
 * `App#creator` grant on `App:<slug>` is a separate record from the tenant role.
 * Before this fix removeMember unassigned by (user, role, tenant) only, leaving
 * a departed member's instance grants in place. No network, no real Permit.
 */
process.env.NODE_ENV = 'test'
process.env.PERMIT_API_KEY = 'ci-no-real-permit-calls'

const unassign = jest.fn(async (_a: unknown) => true)
const listAssignments = jest.fn()

jest.mock('../src/utils/permit/role-assignment', () => ({
  ...jest.requireActual('../src/utils/permit/role-assignment'),
  unassignRoleInPermit: (a: unknown) => unassign(a),
  getUserRoleAssignments: (...args: unknown[]) => listAssignments(...args),
}))

import { PermitAuthorizationProvider } from '../src/providers/permit/PermitAuthorizationProvider'

describe('PermitAuthorizationProvider.removeMember', () => {
  beforeEach(() => {
    unassign.mockClear()
    listAssignments.mockReset()
  })

  it('unassigns tenant roles AND instance-scoped roles, forwarding resource_instance', async () => {
    listAssignments.mockResolvedValue([
      { user: 'u1', role: 'editor', tenant: 't1' },
      { user: 'u1', role: 'creator', tenant: 't1', resource_instance: 'App:my-app' },
      { user: 'u1', role: 'creator', tenant: 't1', resource: 'App', resource_instance_key: 'other-app' },
    ])
    await new PermitAuthorizationProvider().removeMember('t1', 'u1')

    expect(listAssignments).toHaveBeenCalledWith('u1', 't1')
    expect(unassign.mock.calls.map(c => c[0])).toEqual([
      { user: 'u1', role: 'editor', tenant: 't1' },
      { user: 'u1', role: 'creator', tenant: 't1', resource_instance: 'App:my-app' },
      { user: 'u1', role: 'creator', tenant: 't1', resource_instance: 'App:other-app' },
    ])
  })

  it('does not add a resource_instance key to tenant-wide unassigns', async () => {
    listAssignments.mockResolvedValue([{ user: 'u1', role: 'viewer', tenant: 't1' }])
    await new PermitAuthorizationProvider().removeMember('t1', 'u1')
    expect(unassign.mock.calls[0][0]).not.toHaveProperty('resource_instance')
  })

  it('skips rows without a role and tolerates an empty list', async () => {
    listAssignments.mockResolvedValue([{ user: 'u1', tenant: 't1' }])
    await new PermitAuthorizationProvider().removeMember('t1', 'u1')
    listAssignments.mockResolvedValue([])
    await new PermitAuthorizationProvider().removeMember('t1', 'u1')
    expect(unassign).not.toHaveBeenCalled()
  })
})
