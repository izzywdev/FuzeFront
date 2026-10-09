import { describe, expect, it, vi } from 'vitest'
import type { Portfolio } from '@fuzequality/contracts'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

function seed(): Partial<Portfolio> {
  return {
    requirements: [{
      id: 'requirement-a', tenantId: 'tenant-a', jiraKey: 'FQ-47', issueType: 'Story',
      summary: 'Review a suggestion', description: '', status: 'open', project: 'FQ',
      updatedAt: '2026-10-08T00:00:00.000Z',
    }],
    suggestions: [{
      id: 'suggestion-a', requirementId: 'requirement-a', type: 'mapping',
      title: 'Review mapping', confidence: 0.8, evidence: ['source:revision-a'],
      payload: { targetIds: ['target-a'], sourceRevision: 'revision-a', policyVersion: 'mapping-v1' },
      state: 'proposed', createdAt: '2026-10-08T00:00:00.000Z',
    }],
  }
}

const input = { actorId: 'reviewer-a', tenantId: 'tenant-a', action: 'confirm' as const }

describe('FQ-106 suggestion decision security and audit', () => {
  it.each(['confirm', 'edit', 'reject', 'merge', 'suppress'] as const)(
    'attributes %s decisions to the resolved actor and tenant with source provenance',
    async action => {
      const store = new MemoryCatalogStore(seed())
      const decision = {
        ...input, action, reason: 'Reviewed source evidence', owner: 'quality-owner',
        ...(action === 'edit' ? { editedPayload: { targetIds: ['target-b'] } } : {}),
        ...(action === 'merge' ? { targetSuggestionId: 'suggestion-target' } : {}),
        ...(action === 'suppress' ? { expiresAt: '2027-01-01T00:00:00.000Z' } : {}),
      }

      const result = await store.reviewSuggestion('suggestion-a', decision)
      const audits = await store.suggestionDecisions('suggestion-a', 'tenant-a')

      expect(result?.state).toBe(action === 'edit' ? 'proposed' : action === 'reject' ? 'rejected' : action === 'suppress' ? 'suppressed' : 'confirmed')
      expect(audits).toHaveLength(1)
      expect(audits[0]).toMatchObject({
        ...decision, suggestionId: 'suggestion-a',
        originalPayload: { targetIds: ['target-a'], sourceRevision: 'revision-a', policyVersion: 'mapping-v1' },
      })
      expect(audits[0].id).toBeTruthy()
      expect(Number.isNaN(Date.parse(audits[0].decidedAt))).toBe(false)
    },
  )

  it('does not disclose or change another tenant suggestion or create an audit on denial', async () => {
    const store = new MemoryCatalogStore(seed())
    const before = await store.portfolio('tenant-a')
    expect(await store.reviewSuggestion('suggestion-a', { ...input, tenantId: 'tenant-b' })).toBeUndefined()
    expect(await store.suggestionDecisions('suggestion-a', 'tenant-b')).toEqual([])
    expect(await store.suggestionDecisions('suggestion-a', 'tenant-a')).toEqual([])
    expect(await store.portfolio('tenant-a')).toEqual(before)
  })

  it('treats missing and cross-tenant targets identically', async () => {
    const store = new MemoryCatalogStore(seed())
    expect(await store.reviewSuggestion('missing', input)).toBeUndefined()
    expect(await store.reviewSuggestion('suggestion-a', { ...input, tenantId: 'tenant-b' })).toBeUndefined()
    expect(await store.suggestionDecisions('missing', 'tenant-a')).toEqual([])
  })

  it('does not repeat a terminal decision or duplicate its audit on retry', async () => {
    const store = new MemoryCatalogStore(seed())
    await store.reviewSuggestion('suggestion-a', input)
    const first = await store.suggestionDecisions('suggestion-a', 'tenant-a')
    expect(await store.reviewSuggestion('suggestion-a', input)).toBeUndefined()
    expect(await store.suggestionDecisions('suggestion-a', 'tenant-a')).toEqual(first)
    expect((await store.portfolio('tenant-a')).suggestions[0].state).toBe('confirmed')
  })

  it('keeps historical payloads immutable when callers change an edit or returned audit', async () => {
    const store = new MemoryCatalogStore(seed())
    const edit = { ...input, action: 'edit' as const, editedPayload: { targetIds: ['target-b'] } }
    await store.reviewSuggestion('suggestion-a', edit)
    const snapshot = structuredClone(await store.suggestionDecisions('suggestion-a', 'tenant-a'))
    edit.editedPayload.targetIds.push('caller-injected')
    const returned = await store.suggestionDecisions('suggestion-a', 'tenant-a')
    ;(returned[0].originalPayload.targetIds as string[]).push('audit-injected')
    returned[0].actorId = 'forged-actor'
    expect(await store.suggestionDecisions('suggestion-a', 'tenant-a')).toEqual(snapshot)
  })

  it('approves expected-test evidence only in the owning tenant and records a single attributed decision', async () => {
    const data = seed()
    data.suggestions![0].type = 'expected-test'
    const store = new MemoryCatalogStore(data)
    expect(await store.approveExpectedTest('suggestion-a', { ...input, tenantId: 'tenant-b' })).toBeUndefined()
    expect((await store.portfolio('tenant-a')).expectations).toEqual([])
    await store.approveExpectedTest('suggestion-a', input)
    expect(await store.approveExpectedTest('suggestion-a', input)).toBeUndefined()
    const portfolio = await store.portfolio('tenant-a')
    expect(portfolio.expectations).toHaveLength(1)
    expect(portfolio.expectations[0]).toMatchObject({ coverage: 'gap', rule: 'ai-reviewed:suggestion-a' })
    expect(await store.suggestionDecisions('suggestion-a', 'tenant-a')).toEqual([
      expect.objectContaining({ actorId: 'reviewer-a', tenantId: 'tenant-a', action: 'confirm' }),
    ])
  })

  it('rolls back a PostgreSQL decision when its audit cannot be persisted', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT s.*')) return { rows: [{ id: 'suggestion-a', type: 'mapping', payload: { sourceRevision: 'revision-a' } }] }
      if (sql.startsWith('UPDATE fuzequality.suggestions')) return { rows: [{ id: 'suggestion-a', type: 'mapping' }] }
      if (sql.includes('INSERT INTO fuzequality.review_decisions')) throw new Error('audit unavailable')
      return { rows: [] }
    })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    const pool = (store as unknown as { pool: { connect: () => unknown } }).pool
    vi.spyOn(pool, 'connect').mockResolvedValue({ query, release } as never)

    await expect(store.reviewSuggestion('suggestion-a', input)).rejects.toThrow('audit unavailable')
    expect(query).toHaveBeenCalledWith(expect.stringContaining("r.tenant_id=$2 FOR UPDATE"), ['suggestion-a', 'tenant-a'])
    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(query).not.toHaveBeenCalledWith('COMMIT')
    expect(release).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })
})
