import { describe, expect, it } from 'vitest'
import type { Portfolio } from '@fuzequality/contracts'
import { MemoryCatalogStore } from './store'

describe('MemoryCatalogStore tenant isolation', () => {
  it('returns only repository-owned evidence and fails closed for legacy requirement intelligence', async () => {
    const seed: Partial<Portfolio> = {
      repositories: [
        { id: 'repo-a', tenantId: 'tenant-a', owner: 'fuze', name: 'A', canonicalUrl: 'https://github.com/fuze/A', defaultBranch: 'main', kind: 'service', enabled: true, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], lastScanStatus: 'complete' },
        { id: 'repo-b', tenantId: 'tenant-b', owner: 'fuze', name: 'B', canonicalUrl: 'https://github.com/fuze/B', defaultBranch: 'main', kind: 'service', enabled: true, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], lastScanStatus: 'complete' },
      ],
      operations: [
        { id: 'op-a', repositoryId: 'repo-a', documentPath: 'openapi.yaml', method: 'get', path: '/a', summary: 'A', tags: [], security: false, parameters: [], responses: [] },
        { id: 'op-b', repositoryId: 'repo-b', documentPath: 'openapi.yaml', method: 'get', path: '/b', summary: 'B', tags: [], security: false, parameters: [], responses: [] },
      ],
      requirements: [{ id: 'req-global', jiraKey: 'FQ-1', issueType: 'Story', summary: 'Legacy', description: 'Unscoped', status: 'open', project: 'FQ', updatedAt: new Date().toISOString() }],
    }

    const portfolio = await new MemoryCatalogStore(seed).portfolio('tenant-a')

    expect(portfolio.repositories.map(item => item.id)).toEqual(['repo-a'])
    expect(portfolio.operations.map(item => item.id)).toEqual(['op-a'])
    expect(portfolio.requirements).toEqual([])
    expect(portfolio.flows).toEqual([])
    expect(portfolio.suggestions).toEqual([])
  })

  it('creates an immutable audit record when a platform administrator enters tenant context', async () => {
    const store = new MemoryCatalogStore()
    const audit = await store.recordAdminContext({
      actorId: 'platform-admin',
      sourceTenantId: 'platform',
      targetTenantId: 'tenant-a',
      reason: 'Review QA gaps',
      correlationId: 'correlation-1',
    })

    expect(audit).toMatchObject({
      actorId: 'platform-admin',
      sourceTenantId: 'platform',
      targetTenantId: 'tenant-a',
      reason: 'Review QA gaps',
      correlationId: 'correlation-1',
    })
    expect(audit.id).toBeTruthy()
    expect(new Date(audit.createdAt).toString()).not.toBe('Invalid Date')
  })

  it('updates repository administration only inside the caller tenant', async () => {
    const repository = { id: 'repo-a', tenantId: 'tenant-a', owner: 'fuze', name: 'A', canonicalUrl: 'https://github.com/fuze/A', defaultBranch: 'main', kind: 'service' as const, enabled: true, includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], lastScanStatus: 'complete' as const }
    const store = new MemoryCatalogStore({ repositories: [repository] })
    const value = {
      ownership: { team: 'Payments' },
      jiraBindings: [{ project: 'PAY', component: 'Checkout' }],
      storybookBaseUrl: 'https://storybook.example.com',
    }

    expect(await store.updateRepositoryAdministration('repo-a', 'tenant-b', value)).toBeUndefined()
    expect((await store.repository('repo-a', 'tenant-a'))?.ownership).toBeUndefined()

    const updated = await store.updateRepositoryAdministration('repo-a', 'tenant-a', value)
    expect(updated).toMatchObject(value)
  })
})
