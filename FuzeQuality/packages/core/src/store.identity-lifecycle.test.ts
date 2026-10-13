import { describe, expect, it, vi } from 'vitest'
import { InProcessEventBus, relayOutboxBatch, type EventBus } from './events'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

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

  it('revokes local membership projections when an organization or user is deleted', async () => {
    const store = new MemoryCatalogStore()
    await store.upsertTenant({ id: 'org_1', slug: 'acme', name: 'Acme', type: 'organization', active: true })
    await store.upsertPrincipal({ id: 'user_1', email: 'a@acme.test', active: true })
    await store.setOrganizationMembership({ tenantId: 'org_1', principalId: 'user_1', role: 'member', active: true })

    await store.deactivateTenant('org_1')
    await expect(store.setOrganizationMembership({ tenantId: 'org_1', principalId: 'user_1', role: 'member', active: false })).resolves.toBe(false)
    await store.deactivatePrincipal('user_1')
    await expect(store.setOrganizationMembership({ tenantId: 'org_1', principalId: 'user_1', role: 'member', active: false })).resolves.toBe(false)
  })

  it('deactivates org-user projections when either side is deleted', async () => {
    const store = new MemoryCatalogStore()
    const tenant = { id: 'org_1', slug: 'acme', name: 'Acme', type: 'organization' as const, active: true }
    const secondTenant = { id: 'org_2', slug: 'other', name: 'Other', type: 'organization' as const, active: true }
    const principal = { id: 'user_1', email: 'a@acme.test', active: true }
    await store.upsertTenant(tenant)
    await store.upsertTenant(secondTenant)
    await store.upsertPrincipal(principal)
    await store.setOrganizationMembership({ tenantId: tenant.id, principalId: principal.id, role: 'member', active: true })
    await store.setOrganizationMembership({ tenantId: secondTenant.id, principalId: principal.id, role: 'admin', active: true })

    await expect(store.projectIdentityLifecycle(
      { type: 'organization.deleted', tenantId: tenant.id },
      { topic: 'fuzequality.tenant.deleted', key: tenant.id, payload: { tenantId: tenant.id } },
    )).resolves.toBe(true)
    await expect(store.setOrganizationMembership({ tenantId: tenant.id, principalId: principal.id, role: 'member', active: false })).resolves.toBe(false)

    await expect(store.projectIdentityLifecycle(
      { type: 'user.deleted', principalId: principal.id },
      { topic: 'fuzequality.principal.deleted', key: principal.id, payload: { userId: principal.id } },
    )).resolves.toBe(true)
    await expect(store.setOrganizationMembership({ tenantId: secondTenant.id, principalId: principal.id, role: 'admin', active: false })).resolves.toBe(false)
  })

  it.each([
    ['organization.deleted', { type: 'organization.deleted' as const, tenantId: 'org_1' }, 'tenant_id'],
    ['user.deleted', { type: 'user.deleted' as const, principalId: 'user_1' }, 'principal_id'],
  ])('atomically deactivates memberships for Postgres %s projections', async (_name, projection, membershipColumn) => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('deactivated_memberships')) return { rowCount: 1, rows: [{ changed: true }] }
      return { rowCount: 0, rows: [] }
    })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) }

    await expect(store.projectIdentityLifecycle(
      projection,
      { topic: `fuzequality.${_name}`, payload: {} },
    )).resolves.toBe(true)

    const lifecycleSql = query.mock.calls.map(([sql]) => sql).find(sql => sql.includes('deactivated_memberships'))
    expect(lifecycleSql).toContain(`WHERE ${membershipColumn}=$1 AND active=true`)
    expect(query.mock.calls.map(([sql]) => sql.trim().split(/\s/)[0])).toEqual(['BEGIN', 'WITH', 'INSERT', 'COMMIT'])
    expect(release).toHaveBeenCalledOnce()
  })

  it('recovers publication after a broker failure without duplicating the projection event', async () => {
    const store = new MemoryCatalogStore()
    const outbound = { topic: 'fuzequality.tenant.seeded', key: 'org_1', payload: { tenantId: 'org_1' } }
    const projection = {
      type: 'organization.upsert' as const,
      tenant: { id: 'org_1', slug: 'acme', name: 'Acme', type: 'organization' as const, active: true },
    }
    const failedBus: EventBus = { publish: vi.fn().mockRejectedValueOnce(new Error('Kafka unavailable')) }

    await expect(store.projectIdentityLifecycle(projection, outbound)).resolves.toBe(true)
    await expect(relayOutboxBatch(store, failedBus)).rejects.toThrow('Failed to publish 1 outbox event')

    // Identity redelivery is a no-op, but the durable unpublished event remains.
    await expect(store.projectIdentityLifecycle(projection, outbound)).resolves.toBe(false)
    const recoveredBus = new InProcessEventBus()
    await expect(relayOutboxBatch(store, recoveredBus)).resolves.toBe(1)
    await expect(relayOutboxBatch(store, recoveredBus)).resolves.toBe(0)

    expect(recoveredBus.events).toHaveLength(1)
    expect(recoveredBus.events[0]).toMatchObject(outbound)
    expect(recoveredBus.events[0].eventId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('leases pending events so concurrent relays cannot claim the same event', async () => {
    const store = new MemoryCatalogStore()
    await store.projectIdentityLifecycle(
      { type: 'user.upsert', principal: { id: 'user_1', email: 'a@acme.test', active: true } },
      { topic: 'fuzequality.principal.seeded', key: 'user_1', payload: { userId: 'user_1' } },
    )

    const firstLease = await store.claimOutboxEvents()
    const competingLease = await store.claimOutboxEvents()
    expect(firstLease).toHaveLength(1)
    expect(competingLease).toHaveLength(0)
  })

  it('commits the Postgres projection and outbox row in the same transaction', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('RETURNING id')) return { rowCount: 1, rows: [{ id: 'org_1' }] }
      return { rowCount: 0, rows: [] }
    })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) }

    await expect(store.projectIdentityLifecycle(
      { type: 'organization.upsert', tenant: { id: 'org_1', slug: 'acme', name: 'Acme', type: 'organization', active: true } },
      { topic: 'fuzequality.tenant.seeded', key: 'org_1', payload: { tenantId: 'org_1' } },
    )).resolves.toBe(true)

    expect(query.mock.calls.map(([sql]) => sql.trim().split(/\s/)[0])).toEqual(['BEGIN', 'INSERT', 'INSERT', 'COMMIT'])
    expect(release).toHaveBeenCalledOnce()
  })

  it('rolls back the Postgres projection when durable enqueue fails', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO fuzequality.outbox_events')) throw new Error('outbox unavailable')
      if (sql.includes('RETURNING id')) return { rowCount: 1, rows: [{ id: 'org_1' }] }
      return { rowCount: 0, rows: [] }
    })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) }

    await expect(store.projectIdentityLifecycle(
      { type: 'organization.upsert', tenant: { id: 'org_1', slug: 'acme', name: 'Acme', type: 'organization', active: true } },
      { topic: 'fuzequality.tenant.seeded', key: 'org_1', payload: { tenantId: 'org_1' } },
    )).rejects.toThrow('outbox unavailable')

    expect(query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })
})
