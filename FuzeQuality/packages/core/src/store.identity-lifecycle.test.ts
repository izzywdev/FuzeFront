import { describe, expect, it } from 'vitest'
import { MemoryCatalogStore } from './store'

describe('identity lifecycle projection', () => {
  it('is idempotent for identity snapshots and membership redelivery', async () => {
    const store = new MemoryCatalogStore()
    const tenant = { id: 'org_1', slug: 'acme', name: 'Acme', type: 'organization' as const, active: true }
    const principal = { id: 'user_1', email: 'a@acme.test', active: true }
    const membership = { tenantId: tenant.id, principalId: principal.id, role: 'member', active: true }

    await expect(store.upsertTenant(tenant)).resolves.toBe(true)
    await expect(store.upsertTenant(tenant)).resolves.toBe(false)
    await expect(store.upsertPrincipal(principal)).resolves.toBe(true)
    await expect(store.upsertPrincipal(principal)).resolves.toBe(false)
    await expect(store.setOrganizationMembership(membership)).resolves.toBe(true)
    await expect(store.setOrganizationMembership(membership)).resolves.toBe(false)
    await expect(store.setOrganizationMembership({ ...membership, active: false })).resolves.toBe(true)
  })

  it('does not emit a second state change when a delete is redelivered', async () => {
    const store = new MemoryCatalogStore()
    await store.upsertTenant({ id: 'org_1', slug: 'acme', name: 'Acme', type: 'organization', active: true })
    await store.upsertPrincipal({ id: 'user_1', email: 'a@acme.test', active: true })

    await expect(store.deactivateTenant('org_1')).resolves.toBe(true)
    await expect(store.deactivateTenant('org_1')).resolves.toBe(false)
    await expect(store.deactivatePrincipal('user_1')).resolves.toBe(true)
    await expect(store.deactivatePrincipal('user_1')).resolves.toBe(false)
  })
})
