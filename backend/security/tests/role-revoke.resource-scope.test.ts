/**
 * Regression test for a resource-instance-scoping gap in the Permit-backed
 * revoke path.
 *
 * `GrantRevokeRequest.resource` (the contract's ReBAC scope, mirrored from
 * `@fuzefront/auth`'s `authzTypes.ts`) was accepted by
 * `PermitAuthorizationProvider.revoke()` but silently discarded before this
 * fix — `unassignRoleInPermit()`'s parameter type explicitly `Omit`ted
 * `resource_instance`. Permit keys a role assignment by the FULL
 * (user, role, tenant, resource_instance) tuple, so an instance-scoped grant
 * (e.g. `SelectionList:sl_123`) is a different record from a tenant-wide one:
 * dropping `resource_instance` meant a caller revoking one list's grant would
 * get a 204 while Permit's state was unchanged — a silent no-op revoke, the
 * opposite of what the caller asked for and believes happened.
 *
 * This mattered immediately for `selection-list-service`'s migration off an
 * embedded Permit SDK onto this Security API (step 2 of 3): its
 * `DELETE /:listId/access/:userId` depends on `AuthzClient.revoke()` actually
 * reaching Permit with the list's `resource_instance`.
 */
process.env.NODE_ENV = 'test'
process.env.PERMIT_API_KEY = 'ci-no-real-permit-calls'

const unassignMock = jest.fn().mockResolvedValue({})

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: {
    api: {
      roleAssignments: {
        assign: jest.fn().mockResolvedValue({}),
        unassign: unassignMock,
        list: jest.fn().mockResolvedValue([]),
      },
    },
  },
  permitConfig: { token: 'ci-no-real-permit-calls', pdp: 'http://localhost:7766' },
}))

import { unassignRoleInPermit } from '../src/utils/permit/role-assignment'
import { PermitAuthorizationProvider } from '../src/providers/permit/PermitAuthorizationProvider'

describe('unassignRoleInPermit — forwards resource_instance', () => {
  beforeEach(() => unassignMock.mockClear())

  it('passes resource_instance through to permit.api.roleAssignments.unassign when supplied', async () => {
    await unassignRoleInPermit({
      user: 'usr_1',
      role: 'list-owner',
      tenant: 'org_acme',
      resource_instance: 'SelectionList:sl_123',
    })

    expect(unassignMock).toHaveBeenCalledWith({
      user: 'usr_1',
      role: 'list-owner',
      tenant: 'org_acme',
      resource_instance: 'SelectionList:sl_123',
    })
  });

  it('omits resource_instance for a tenant-wide unassign (organization-role helpers)', async () => {
    await unassignRoleInPermit({ user: 'usr_1', role: 'admin', tenant: 'org_acme' })

    expect(unassignMock).toHaveBeenCalledWith({
      user: 'usr_1',
      role: 'admin',
      tenant: 'org_acme',
    })
  });
})

describe('PermitAuthorizationProvider.revoke — forwards req.resource as resource_instance', () => {
  beforeEach(() => unassignMock.mockClear())
  const provider = new PermitAuthorizationProvider()

  it('scopes the revoke to the resource instance when req.resource is present', async () => {
    await provider.revoke({
      subject: 'usr_1',
      tenant: 'org_acme',
      role: 'list-owner',
      resource: { type: 'SelectionList', key: 'sl_123' },
    })

    expect(unassignMock).toHaveBeenCalledWith({
      user: 'usr_1',
      role: 'list-owner',
      tenant: 'org_acme',
      resource_instance: 'SelectionList:sl_123',
    })
  });

  it('leaves resource_instance undefined (tenant-wide) when req.resource is absent', async () => {
    await provider.revoke({ subject: 'usr_1', tenant: 'org_acme', role: 'admin' })

    expect(unassignMock).toHaveBeenCalledWith({
      user: 'usr_1',
      role: 'admin',
      tenant: 'org_acme',
      resource_instance: undefined,
    })
  });
})
