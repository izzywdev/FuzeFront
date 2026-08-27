/**
 * machine-roles-service-endpoint.test.ts
 *
 * Unit tests for the ServiceEndpoint invoke grant/revoke helpers added for the
 * platform S2S identity foundation (izzywdev/FuzeFront#648):
 * `grantServiceInvoke` / `revokeServiceInvoke` in utils/permit/machine-roles.ts.
 *
 * Uses a scriptable Permit mock (not the no-op proxy machine-auth.test.ts uses)
 * so idempotent-409 and hard-failure branches can be exercised explicitly.
 */

const mockPermit = {
  api: {
    resourceInstances: { create: jest.fn() },
    roleAssignments: { assign: jest.fn(), unassign: jest.fn() },
  },
}
jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: mockPermit,
  destroyPermitClient: jest.fn(),
}))

import { grantServiceInvoke, revokeServiceInvoke, PLATFORM_TENANT } from '../src/utils/permit/machine-roles'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('grantServiceInvoke()', () => {
  it('creates the resource instance then assigns the s2s-caller role', async () => {
    mockPermit.api.resourceInstances.create.mockResolvedValueOnce(undefined)
    mockPermit.api.roleAssignments.assign.mockResolvedValueOnce(undefined)

    const result = await grantServiceInvoke('client-abc', 'fuzecall_control_plane')

    expect(result).toBe(true)
    expect(mockPermit.api.resourceInstances.create).toHaveBeenCalledWith({
      key: 'fuzecall_control_plane',
      resource: 'ServiceEndpoint',
      tenant: PLATFORM_TENANT,
    })
    expect(mockPermit.api.roleAssignments.assign).toHaveBeenCalledWith({
      user: 'svc:client-abc',
      role: 's2s-caller',
      resource_instance: 'ServiceEndpoint:fuzecall_control_plane',
      tenant: PLATFORM_TENANT,
    })
  })

  it('does not double-prefix a client_id that already carries svc:', async () => {
    mockPermit.api.resourceInstances.create.mockResolvedValueOnce(undefined)
    mockPermit.api.roleAssignments.assign.mockResolvedValueOnce(undefined)

    await grantServiceInvoke('svc:client-abc', 'fuzecall_control_plane')

    expect(mockPermit.api.roleAssignments.assign).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'svc:client-abc' })
    )
  })

  it('is idempotent — a 409 on resource-instance create is not fatal', async () => {
    mockPermit.api.resourceInstances.create.mockRejectedValueOnce({ response: { status: 409 } })
    mockPermit.api.roleAssignments.assign.mockResolvedValueOnce(undefined)

    const result = await grantServiceInvoke('client-abc', 'fuzecall_control_plane')

    expect(result).toBe(true)
    expect(mockPermit.api.roleAssignments.assign).toHaveBeenCalled()
  })

  it('is idempotent — a 409 on role assignment is treated as already-granted', async () => {
    mockPermit.api.resourceInstances.create.mockResolvedValueOnce(undefined)
    mockPermit.api.roleAssignments.assign.mockRejectedValueOnce({ response: { status: 409 } })

    const result = await grantServiceInvoke('client-abc', 'fuzecall_control_plane')

    expect(result).toBe(true)
  })

  it('fails safe (false, never throws) on a non-409 resource-instance error', async () => {
    mockPermit.api.resourceInstances.create.mockRejectedValueOnce(new Error('PDP unreachable'))

    const result = await grantServiceInvoke('client-abc', 'fuzecall_control_plane')

    expect(result).toBe(false)
    expect(mockPermit.api.roleAssignments.assign).not.toHaveBeenCalled()
  })

  it('fails safe (false, never throws) on a non-409 role-assignment error', async () => {
    mockPermit.api.resourceInstances.create.mockResolvedValueOnce(undefined)
    mockPermit.api.roleAssignments.assign.mockRejectedValueOnce(new Error('PDP unreachable'))

    const result = await grantServiceInvoke('client-abc', 'fuzecall_control_plane')

    expect(result).toBe(false)
  })

  it('accepts a custom tenant', async () => {
    mockPermit.api.resourceInstances.create.mockResolvedValueOnce(undefined)
    mockPermit.api.roleAssignments.assign.mockResolvedValueOnce(undefined)

    await grantServiceInvoke('client-abc', 'fuzecall_control_plane', 'org-xyz')

    expect(mockPermit.api.resourceInstances.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 'org-xyz' })
    )
    expect(mockPermit.api.roleAssignments.assign).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 'org-xyz' })
    )
  })
})

describe('revokeServiceInvoke()', () => {
  it('unassigns the s2s-caller role', async () => {
    mockPermit.api.roleAssignments.unassign.mockResolvedValueOnce(undefined)

    const result = await revokeServiceInvoke('client-abc', 'fuzecall_control_plane')

    expect(result).toBe(true)
    expect(mockPermit.api.roleAssignments.unassign).toHaveBeenCalledWith({
      user: 'svc:client-abc',
      role: 's2s-caller',
      resource_instance: 'ServiceEndpoint:fuzecall_control_plane',
      tenant: PLATFORM_TENANT,
    })
  })

  it('fails safe (false, never throws) on error', async () => {
    mockPermit.api.roleAssignments.unassign.mockRejectedValueOnce(new Error('PDP unreachable'))

    const result = await revokeServiceInvoke('client-abc', 'fuzecall_control_plane')

    expect(result).toBe(false)
  })
})
