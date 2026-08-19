import { describe, expect, it } from 'vitest'
import { MemoryCatalogStore } from './store'

const input = {
  owner: 'izzywdev', name: 'FuzeOne', defaultBranch: 'master', kind: 'mixed' as const,
  installationId: '42', includeGlobs: ['services/**'], excludeGlobs: ['**/dist/**'],
  jiraProjects: ['FQ'], jiraBindings: [{ project: 'FQ', component: 'Quality' }],
  ownership: { team: 'FuzeOne', contact: 'owner@example.com' },
}

describe('FQ-18 tenant-aware repository persistence', () => {
  it('is idempotent within a tenant and isolated between tenants', async () => {
    const store = new MemoryCatalogStore()
    const first = await store.addRepository(input, 'tenant-a')
    const repeated = await store.addRepository({ ...input, kind: 'service' }, 'tenant-a')
    const otherTenant = await store.addRepository(input, 'tenant-b')

    expect(repeated.id).toBe(first.id)
    expect(repeated.kind).toBe('service')
    expect(otherTenant.id).not.toBe(first.id)
    expect((await store.portfolio('tenant-a')).repositories).toHaveLength(1)
    expect((await store.portfolio('tenant-a')).repositories[0].ownership?.team).toBe('FuzeOne')
    expect(await store.repository(otherTenant.id, 'tenant-a')).toBeUndefined()
  })
})
