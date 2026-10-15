import { describe, expect, it, vi } from 'vitest'
import type { RepositoryFlowCandidate } from '@fuzequality/contracts'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

const candidate: RepositoryFlowCandidate = {
  id: 'flow-candidate-1',
  repositoryId: 'repo-1',
  tenantId: 'tenant-1',
  revision: 'abc123',
  title: 'Install an application',
  confidence: 0.91,
  evidence: ['route-1'],
  steps: [{ actor: 'owner', action: 'installs the app', expectedOutcome: 'the app is available', targetIds: ['route-1'] }],
  wireframe: { kind: 'sequence', nodes: [{ label: 'Install the app', targetIds: ['route-1'] }] },
  status: 'proposed',
  source: 'litellm',
  createdAt: '2026-10-09T00:00:00.000Z',
}

describe('repository flow review lifecycle', () => {
  it('paginates newest-first history with a stable timestamp and id cursor', async () => {
    const store = new MemoryCatalogStore()
    const sameTime = '2026-10-09T00:00:00.000Z'
    await store.saveRepositoryFlowCandidates([
      { ...candidate, id: 'flow-c', title: 'Flow C', createdAt: sameTime },
      { ...candidate, id: 'flow-b', title: 'Flow B', createdAt: sameTime },
      { ...candidate, id: 'flow-a', title: 'Flow A', createdAt: '2026-10-08T00:00:00.000Z' },
      { ...candidate, id: 'other-tenant', title: 'Other tenant', tenantId: 'tenant-2', createdAt: '2026-10-10T00:00:00.000Z' },
    ])

    const first = await store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId, { limit: 2 })
    expect(first.map(item => item.id)).toEqual(['flow-c', 'flow-b'])
    await expect(store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId, {
      after: { createdAt: first[1].createdAt, id: first[1].id },
      limit: 2,
    })).resolves.toEqual([expect.objectContaining({ id: 'flow-a' })])
  })

  it('persists FuzeInfra LiteLLM analysis provenance', async () => {
    const store = new MemoryCatalogStore()
    const analysis = {
      provider: 'fuzeinfra-litellm' as const,
      model: 'quality-analysis',
      promptVersion: 'fuzequality-repository-flow-v1',
      schemaVersion: '1.0',
    }
    await store.saveRepositoryFlowCandidates([{ ...candidate, analysis }])
    await expect(store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId)).resolves.toEqual([
      expect.objectContaining({ analysis }),
    ])
  })

  it('filters confidence inclusively while preserving tenant isolation', async () => {
    const store = new MemoryCatalogStore()
    await store.saveRepositoryFlowCandidates([
      { ...candidate, id: 'low', title: 'Low confidence', confidence: 0.69 },
      { ...candidate, id: 'minimum', title: 'Minimum confidence', confidence: 0.7 },
      { ...candidate, id: 'maximum', title: 'Maximum confidence', confidence: 0.9 },
      { ...candidate, id: 'high', title: 'High confidence', confidence: 0.91 },
      { ...candidate, id: 'other-tenant', title: 'Other tenant', tenantId: 'tenant-2', confidence: 0.8 },
    ])

    const matches = await store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId, {
      minConfidence: 0.7,
      maxConfidence: 0.9,
    })
    expect(matches.map(item => item.id).sort()).toEqual(['maximum', 'minimum'])
  })

  it('binds confidence filters before the stable Postgres continuation cursor', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId, {
      minConfidence: 0.7,
      maxConfidence: 0.9,
      after: { createdAt: candidate.createdAt, id: candidate.id },
      limit: 25,
    })

    const [statement, parameters] = query.mock.calls[0]
    expect(String(statement)).toContain('confidence >= $10')
    expect(String(statement)).toContain('confidence <= $11')
    expect(String(statement)).toContain('(created_at,id) < ($12::timestamptz,$13::text)')
    expect(parameters).toEqual([
      candidate.repositoryId,
      candidate.tenantId,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0.7,
      0.9,
      candidate.createdAt,
      candidate.id,
      25,
    ])
  })

  it('preserves the human decision and attribution when the same analysis is replayed', async () => {
    const store = new MemoryCatalogStore()
    await store.saveRepositoryFlowCandidates([candidate])
    await expect(store.reviewRepositoryFlowCandidate(candidate.id, candidate.tenantId, {
      status: 'confirmed',
      reviewedBy: 'reviewer-1',
      reason: 'Matches the production journey.',
    })).resolves.toMatchObject({
      status: 'confirmed',
      reviewedBy: 'reviewer-1',
      reviewReason: 'Matches the production journey.',
      reviewedAt: expect.any(String),
    })

    await store.saveRepositoryFlowCandidates([{ ...candidate, confidence: 0.97 }])
    await expect(store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId)).resolves.toEqual([
      expect.objectContaining({
        confidence: 0.97,
        status: 'confirmed',
        reviewedBy: 'reviewer-1',
        reviewReason: 'Matches the production journey.',
        reviewedAt: expect.any(String),
      }),
    ])
  })

  it('persists same-title candidates independently by grounded identity', async () => {
    const store = new MemoryCatalogStore()
    await store.saveRepositoryFlowCandidates([
      candidate,
      {
        ...candidate,
        id: 'flow-candidate-2',
        evidence: ['route-2'],
        steps: [{ ...candidate.steps[0], targetIds: ['route-2'] }],
        wireframe: { kind: 'sequence', nodes: [{ label: 'Install the app', targetIds: ['route-2'] }] },
      },
    ])

    const candidates = await store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId)
    expect(candidates).toHaveLength(2)
    expect(candidates.map(item => item.id).sort()).toEqual(['flow-candidate-1', 'flow-candidate-2'])
  })

  it('upserts Postgres candidates by id without allowing cross-tenant identity mutation', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.saveRepositoryFlowCandidates([candidate])

    const [statement] = query.mock.calls[0]
    expect(String(statement)).toContain('ON CONFLICT (id) DO UPDATE')
    expect(String(statement)).toContain('repository_flow_candidates.tenant_id=EXCLUDED.tenant_id')
    expect(String(statement)).not.toContain('ON CONFLICT (repository_id,revision,title,source)')
  })

  it('does not let an id collision mutate a candidate owned by another tenant', async () => {
    const store = new MemoryCatalogStore()
    await store.saveRepositoryFlowCandidates([candidate])
    await store.saveRepositoryFlowCandidates([{
      ...candidate,
      tenantId: 'tenant-2',
      title: 'Injected title',
      evidence: ['route-injected'],
    }])

    await expect(store.repositoryFlowCandidates(candidate.repositoryId, candidate.tenantId)).resolves.toEqual([
      expect.objectContaining({ title: candidate.title, evidence: candidate.evidence }),
    ])
    await expect(store.repositoryFlowCandidates(candidate.repositoryId, 'tenant-2')).resolves.toEqual([])
  })

  it('keeps immutable newest-first history and isolates it by tenant', async () => {
    const store = new MemoryCatalogStore()
    await store.saveRepositoryFlowCandidates([candidate])
    await store.reviewRepositoryFlowCandidate(candidate.id, candidate.tenantId, {
      status: 'confirmed', reviewedBy: 'reviewer-1', reason: 'Evidence is complete.',
    })
    await store.reviewRepositoryFlowCandidate(candidate.id, candidate.tenantId, {
      status: 'rejected', reviewedBy: 'reviewer-2', reason: 'The route was removed.',
    })

    await expect(store.repositoryFlowReviewHistory(candidate.id, candidate.tenantId)).resolves.toEqual([
      expect.objectContaining({ id: expect.any(String), status: 'rejected', reviewedBy: 'reviewer-2', reason: 'The route was removed.', createdAt: expect.any(String) }),
      expect.objectContaining({ id: expect.any(String), status: 'confirmed', reviewedBy: 'reviewer-1', reason: 'Evidence is complete.', createdAt: expect.any(String) }),
    ])
    const [first] = await store.repositoryFlowReviewHistory(candidate.id, candidate.tenantId, { limit: 1 })
    await expect(store.repositoryFlowReviewHistory(candidate.id, candidate.tenantId, {
      after: { createdAt: first.createdAt, id: first.id },
      limit: 1,
    })).resolves.toEqual([expect.objectContaining({ reviewedBy: 'reviewer-1' })])
    await expect(store.repositoryFlowReviewHistory(candidate.id, 'tenant-2')).resolves.toEqual([])
    await expect(store.reviewRepositoryFlowCandidate(candidate.id, 'tenant-2', {
      status: 'confirmed', reviewedBy: 'cross-tenant-reviewer',
    })).resolves.toBeUndefined()
  })

  it('atomically rejects a review when the repository revision changed', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    }

    await expect(store.reviewRepositoryFlowCandidate(candidate.id, candidate.tenantId, {
      status: 'confirmed',
      reviewedBy: 'reviewer-1',
    }, candidate.revision)).resolves.toBeUndefined()

    const [statement, parameters] = query.mock.calls[1]
    expect(String(statement)).toContain('candidate.revision=$6')
    expect(String(statement)).toContain('repository.last_scan_revision=$6')
    expect(String(statement)).toContain('FOR UPDATE')
    expect(parameters[5]).toBe(candidate.revision)
    expect(query).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledOnce()
  })

  it('uses database-compatible UUIDs for persisted review history and its cursor', async () => {
    const reviewedAt = new Date('2026-10-09T01:00:00.000Z')
    const createdAt = new Date(candidate.createdAt)
    const query = vi.fn().mockImplementation(async (statement: string) => {
      if (statement.includes('UPDATE fuzequality.repository_flow_candidates')) {
        return { rows: [{
          id: candidate.id, repository_id: candidate.repositoryId, tenant_id: candidate.tenantId,
          revision: candidate.revision, title: candidate.title, confidence: candidate.confidence,
          evidence: candidate.evidence, steps: candidate.steps, wireframe: candidate.wireframe,
          status: 'confirmed', reviewed_at: reviewedAt, reviewed_by: 'reviewer-1', review_reason: null,
          analysis_provenance: null, source: candidate.source, created_at: createdAt,
        }] }
      }
      return { rows: [] }
    })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
      query,
    }

    await store.reviewRepositoryFlowCandidate(candidate.id, candidate.tenantId, {
      status: 'confirmed', reviewedBy: 'reviewer-1',
    })
    const historyInsert = query.mock.calls.find(([statement]) =>
      String(statement).includes('INSERT INTO fuzequality.repository_flow_review_history')
    )
    expect(historyInsert?.[1][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

    const cursorId = '00000000-0000-4000-8000-000000000001'
    await store.repositoryFlowReviewHistory(candidate.id, candidate.tenantId, {
      after: { createdAt: candidate.createdAt, id: cursorId }, limit: 25,
    })
    const historyQuery = query.mock.calls.at(-1)
    expect(String(historyQuery?.[0])).toContain('($3::timestamptz,$4::uuid)')
    expect(historyQuery?.[1]).toEqual([candidate.id, candidate.tenantId, candidate.createdAt, cursorId, 25])
  })
})
