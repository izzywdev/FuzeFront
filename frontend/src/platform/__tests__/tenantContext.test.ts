import { describe, expect, it } from 'vitest'
import { createFederatedTenantResolver, resolveFederatedTenantId } from '../tenantContext'

describe('federated tenant context', () => {
  it('preserves a persisted organization before organization metadata hydrates', () => {
    expect(resolveFederatedTenantId({
      activeOrganizationId: 'org-selected',
      organizations: [],
      personalTenantId: 'org-personal',
    })).toBe('org-selected')
  })

  it('uses the Security-owned Personal tenant only in Personal context', () => {
    expect(resolveFederatedTenantId({
      activeOrganizationId: null,
      organizations: [{ id: 'org-personal-fallback', type: 'personal' }],
      personalTenantId: 'org-personal',
    })).toBe('org-personal')
    expect(resolveFederatedTenantId({
      activeOrganizationId: null,
      organizations: [{ id: 'org-personal-fallback', type: 'personal' }],
      personalTenantId: null,
    })).toBe('org-personal-fallback')
  })

  it('publishes the selected workspace through the remote security contract', () => {
    expect(createFederatedTenantResolver('org-selected')()).toBe('org-selected')
    expect(createFederatedTenantResolver(null)()).toBeNull()
  })
})
