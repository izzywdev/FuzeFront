import { describe, expect, it, vi } from 'vitest'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'
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

  it('preserves a reviewed pre-tenant suggestion and its confirmed flow on replay', async () => {
    const store = new MemoryCatalogStore()
    const tenantId = 'tenant-a'
    const requirement = {
      id: 'jira:FQ-203', jiraKey: 'FQ-203', issueType: 'Story' as const, summary: 'Reviewed analysis',
      description: 'Analyze safely.', status: 'In Progress', project: 'FQ', updatedAt: '2026-10-28T00:00:00.000Z',
    }
    const requirementId = tenantRequirementId(tenantId, requirement.jiraKey)
    const legacyId = '11111111-1111-4111-a111-111111111111'
    const legacyFlow = {
      id: 'flow:FQ-203:legacy', requirementId, title: 'Reviewed flow', origin: 'inferred' as const,
      status: 'proposed' as const, actors: ['reviewer'], preconditions: [], trigger: 'review', steps: [],
    }
    const legacySuggestion = {
      id: legacyId, requirementId, type: 'flow' as const, title: 'Reviewed flow', confidence: 0.9,
      evidence: ['reviewed'], payload: legacyFlow, state: 'proposed' as const, createdAt: requirement.updatedAt,
    }

    await store.saveIntelligence([{ requirement, suggestions: [legacySuggestion] }], {
      sourceType: 'jira', sourceKey: 'default', tenantId, cursor: 'legacy',
    })
    await store.reviewSuggestion(legacyId, { actorId: 'reviewer', tenantId, action: 'confirm' })
    await store.saveIntelligence([{ requirement, suggestions: [{
      ...legacySuggestion,
      id: '22222222-2222-4222-a222-222222222222',
      payload: { ...legacyFlow, id: 'flow:tenant:FQ-203:new' },
      compatibilityIds: [legacyId],
    }] }], { sourceType: 'jira', sourceKey: 'default', tenantId, cursor: 'replay' })

    const portfolio = await store.portfolio(tenantId)
    expect(portfolio.suggestions).toMatchObject([{ id: legacyId, state: 'confirmed' }])
    expect(portfolio.flows).toMatchObject([{ id: legacyFlow.id, status: 'confirmed' }])
    expect(await store.suggestionDecisions(legacyId, tenantId)).toHaveLength(1)
  })

  it('reuses a tenant-owned legacy suggestion in PostgreSQL instead of reopening it', async () => {
    const legacyId = '11111111-1111-4111-a111-111111111111'
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('INSERT INTO fuzequality.requirements')) return { rowCount: 1, rows: [{ id: 'requirement-db-id' }] }
      if (sql.startsWith('SELECT id FROM fuzequality.suggestions')) return { rowCount: 1, rows: [{ id: legacyId }] }
      return { rowCount: 0, rows: [] }
    })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    }
    const requirement = {
      id: 'jira:FQ-203', jiraKey: 'FQ-203', issueType: 'Story' as const, summary: 'Reviewed analysis',
      description: 'Analyze safely.', status: 'In Progress', project: 'FQ', updatedAt: '2026-10-28T00:00:00.000Z',
    }

    await store.saveIntelligence([{ requirement, suggestions: [{
      id: '22222222-2222-4222-a222-222222222222', requirementId: tenantRequirementId('tenant-a', 'FQ-203'),
      type: 'missing-criteria', title: 'Reviewed criterion', confidence: 0.9, evidence: ['reviewed'],
      payload: { criterion: 'Keep the decision.' }, state: 'proposed', createdAt: requirement.updatedAt,
      compatibilityIds: [legacyId],
    }] }], { sourceType: 'jira', sourceKey: 'default', tenantId: 'tenant-a', cursor: 'replay' })

    expect(query).toHaveBeenCalledWith(
      'SELECT id FROM fuzequality.suggestions WHERE requirement_id=$1 AND id = ANY($2::uuid[]) LIMIT 1',
      ['requirement-db-id', [legacyId]],
    )
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO fuzequality.suggestions'))).toBe(false)
    expect(query).toHaveBeenCalledWith('COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })
})
