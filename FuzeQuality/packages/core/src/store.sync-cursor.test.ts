import { describe, expect, it } from 'vitest'
import { MemoryCatalogStore } from './store'
import { tenantRequirementId } from './intelligence'

describe('requirement sync cursors', () => {
  it('moves the cursor only with a successfully saved intelligence batch', async () => {
    const store = new MemoryCatalogStore()
    expect(await store.syncCursor('jira', 'fq-product', 'tenant-a')).toBeUndefined()

    await store.saveIntelligence([], {
      sourceType: 'jira',
      sourceKey: 'fq-product',
      cursor: '2026-09-10T03:00:00.000Z',
      tenantId: 'tenant-a',
    })

    expect(await store.syncCursor('jira', 'fq-product', 'tenant-a')).toMatchObject({
      sourceType: 'jira',
      sourceKey: 'fq-product',
      cursor: '2026-09-10T03:00:00.000Z',
      freshnessStatus: 'fresh',
    })
  })

  it('retains a safe dependency failure code and clears it after a successful batch', async () => {
    const store = new MemoryCatalogStore()

    await store.markSyncFailed('jira', 'fq-product', 'tenant-a', 'INTELLIGENCE_UNAVAILABLE')
    expect(await store.syncCursor('jira', 'fq-product', 'tenant-a')).toEqual({
      sourceType: 'jira',
      sourceKey: 'fq-product',
      tenantId: 'tenant-a',
      cursor: undefined,
      lastSuccessAt: undefined,
      freshnessStatus: 'failed',
      failureCode: 'INTELLIGENCE_UNAVAILABLE',
    })

    await store.saveIntelligence([], {
      sourceType: 'jira',
      sourceKey: 'fq-product',
      cursor: '2026-09-10T03:00:00.000Z',
      tenantId: 'tenant-a',
    })
    expect(await store.syncCursor('jira', 'fq-product', 'tenant-a')).toMatchObject({
      freshnessStatus: 'fresh',
      failureCode: undefined,
    })
  })

  it('isolates cursors and failure state between tenants and retains a queued retry', async () => {
    const store = new MemoryCatalogStore()

    await store.saveIntelligence([], {
      sourceType: 'jira', sourceKey: 'default', tenantId: 'tenant-a', cursor: '2026-09-10T03:00:00.000Z',
    })
    await store.markSyncFailed('jira', 'default', 'tenant-b', 'JIRA_UNAVAILABLE')

    expect(await store.syncCursor('jira', 'default', 'tenant-a')).toMatchObject({
      cursor: '2026-09-10T03:00:00.000Z', freshnessStatus: 'fresh',
    })
    expect(await store.syncCursor('jira', 'default', 'tenant-b')).toMatchObject({
      cursor: undefined, freshnessStatus: 'failed', failureCode: 'JIRA_UNAVAILABLE',
    })

    await expect(store.markSyncQueued('jira', 'default', 'tenant-b')).resolves.toMatchObject({
      freshnessStatus: 'queued', failureCode: undefined,
    })
    expect(await store.syncCursorStatuses('jira', 'default')).toHaveLength(2)
  })

  it('returns only active projected tenants for scheduled reconciliation', async () => {
    const store = new MemoryCatalogStore()
    await store.upsertTenant({ id: 'tenant-b', slug: 'b', name: 'B', type: 'organization', active: true })
    await store.upsertTenant({ id: 'tenant-a', slug: 'a', name: 'A', type: 'personal', active: true })
    await store.upsertTenant({ id: 'tenant-z', slug: 'z', name: 'Z', type: 'organization', active: false })

    await expect(store.activeTenantIds()).resolves.toEqual(['tenant-a', 'tenant-b'])
  })

  it('keeps identical Jira keys and their suggestions isolated between tenants', async () => {
    const store = new MemoryCatalogStore()
    const requirement = {
      id: 'jira:FQ-203', jiraKey: 'FQ-203', issueType: 'Story' as const, summary: 'Reviewed analysis',
      description: 'Analyze safely.', status: 'In Progress', project: 'FQ', updatedAt: '2026-10-28T00:00:00.000Z',
    }
    const result = (tenantId: string) => ({
      requirement,
      suggestions: [{
        id: `suggestion-${tenantId}`, requirementId: tenantRequirementId(tenantId, requirement.jiraKey),
        type: 'missing-criteria' as const, title: `Suggestion ${tenantId}`, confidence: 0.8,
        evidence: ['reviewed'], payload: {}, state: 'proposed' as const, createdAt: '2026-10-28T00:00:00.000Z',
      }],
    })

    await store.saveIntelligence([result('tenant-a')], { sourceType: 'jira', sourceKey: 'default', tenantId: 'tenant-a', cursor: 'a' })
    await store.saveIntelligence([result('tenant-b')], { sourceType: 'jira', sourceKey: 'default', tenantId: 'tenant-b', cursor: 'b' })

    await expect(store.portfolio('tenant-a')).resolves.toMatchObject({
      requirements: [{ id: tenantRequirementId('tenant-a', 'FQ-203') }],
      suggestions: [{ id: 'suggestion-tenant-a' }],
    })
    await expect(store.portfolio('tenant-b')).resolves.toMatchObject({
      requirements: [{ id: tenantRequirementId('tenant-b', 'FQ-203') }],
      suggestions: [{ id: 'suggestion-tenant-b' }],
    })
  })
})
