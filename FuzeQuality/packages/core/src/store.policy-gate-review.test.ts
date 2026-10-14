import { describe, expect, it, vi } from 'vitest'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

describe('policy-gate review lifecycle', () => {
  it('paginates tenant-scoped findings with stable timestamp tie-breaking', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const }
    await store.savePolicyGateEvaluations([
      { ...base, id: 'evaluation-c', title: 'Finding C', createdAt: '2026-10-09T00:00:00.000Z' },
      { ...base, id: 'evaluation-b', title: 'Finding B', createdAt: '2026-10-09T00:00:00.000Z' },
      { ...base, id: 'evaluation-a', title: 'Finding A', createdAt: '2026-10-08T00:00:00.000Z' },
      { ...base, id: 'other-tenant', tenantId: 'tenant-2', title: 'Other tenant', createdAt: '2026-10-10T00:00:00.000Z' },
    ])

    const first = await store.policyGateEvaluations('repo-1', 'tenant-1', { limit: 2 })
    expect(first.map(item => item.id)).toEqual(['evaluation-c', 'evaluation-b'])
    await expect(store.policyGateEvaluations('repo-1', 'tenant-1', {
      after: { createdAt: first[1].createdAt, id: first[1].id },
      limit: 2,
    })).resolves.toEqual([expect.objectContaining({ id: 'evaluation-a' })])
  })

  it('keeps an explicit review decision when the same revision is re-analysed', async () => {
    const store = new MemoryCatalogStore()
    const evaluation = { id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, title: 'Missing deployment guard', detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const, createdAt: '2026-10-08T00:00:00.000Z' }
    await store.savePolicyGateEvaluations([evaluation])
    await expect(store.reviewPolicyGateEvaluation(evaluation.id, evaluation.tenantId, { status: 'accepted', reviewedBy: 'user-1', reason: 'Threshold is already enforced elsewhere.' })).resolves.toMatchObject({ reviewStatus: 'accepted', reviewedBy: 'user-1' })
    await store.savePolicyGateEvaluations([evaluation])
    await expect(store.policyGateEvaluations(evaluation.repositoryId, evaluation.tenantId)).resolves.toEqual([expect.objectContaining({ reviewStatus: 'accepted', reviewedAt: expect.any(String), reviewedBy: 'user-1', reviewReason: 'Threshold is already enforced elsewhere.' })])
    await store.reviewPolicyGateEvaluation(evaluation.id, evaluation.tenantId, { status: 'dismissed', reviewedBy: 'user-3', reason: 'The replacement control was removed.' })
    const history = await store.policyGateReviewHistory(evaluation.id, evaluation.tenantId)
    expect(history).toEqual([
      expect.objectContaining({ id: expect.any(String), status: 'dismissed', reviewedBy: 'user-3', reason: 'The replacement control was removed.', createdAt: expect.any(String) }),
      expect.objectContaining({ id: expect.any(String), status: 'accepted', reviewedBy: 'user-1', reason: 'Threshold is already enforced elsewhere.', createdAt: expect.any(String) }),
    ])
    await expect(store.policyGateReviewHistory(evaluation.id, evaluation.tenantId, {
      after: { createdAt: history[0].createdAt, id: history[0].id },
      limit: 1,
    })).resolves.toEqual([expect.objectContaining({ reviewedBy: 'user-1' })])
    await expect(store.policyGateReviewHistory(evaluation.id, 'tenant-2')).resolves.toEqual([])
    await expect(store.reviewPolicyGateEvaluation(evaluation.id, 'tenant-2', { status: 'dismissed', reviewedBy: 'user-2' })).resolves.toBeUndefined()
  })

  it('filters policy findings by inclusive confidence bounds and tenant', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const, createdAt: '2026-10-09T00:00:00.000Z' }
    await store.savePolicyGateEvaluations([
      { ...base, id: 'low', title: 'Low confidence', confidence: 0.69 },
      { ...base, id: 'minimum', title: 'Minimum confidence', confidence: 0.7 },
      { ...base, id: 'maximum', title: 'Maximum confidence', confidence: 0.9 },
      { ...base, id: 'other-subject', title: 'Other subject', confidence: 0.8, scope: { sourcePaths: ['governance/authentication.md'], subjects: ['authentication'] } },
      { ...base, id: 'high', title: 'High confidence', confidence: 0.91 },
      { ...base, id: 'other-tenant', tenantId: 'tenant-2', title: 'Other tenant', confidence: 0.8 },
    ])

    const matches = await store.policyGateEvaluations('repo-1', 'tenant-1', {
      minConfidence: 0.7,
      maxConfidence: 0.9,
      subject: 'DEPLOYMENT',
    })
    expect(matches.map(item => item.id).sort()).toEqual(['maximum', 'minimum'])
  })

  it('binds policy confidence before the stable Postgres continuation cursor', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.policyGateEvaluations('repo-1', 'tenant-1', {
      minConfidence: 0.7,
      maxConfidence: 0.9,
      subject: 'Deployment',
      after: { createdAt: '2026-10-09T00:00:00.000Z', id: 'evaluation-1' },
      limit: 25,
    })

    const [statement, parameters] = query.mock.calls[0]
    expect(String(statement)).toContain('confidence >= $8')
    expect(String(statement)).toContain('confidence <= $9')
    expect(String(statement)).toContain('(created_at,id) < ($10::timestamptz,$11::text)')
    expect(String(statement)).toContain("jsonb_array_elements_text(COALESCE(scope->'subjects', '[]'::jsonb))")
    expect(String(statement)).toContain('lower(scoped_subject.value)=lower($13)')
    expect(parameters).toEqual([
      'repo-1', 'tenant-1', null, null, null, null, null,
      0.7, 0.9, '2026-10-09T00:00:00.000Z', 'evaluation-1', 25, 'Deployment',
    ])
  })

  it('persists exact evidence passages with the deterministic evaluation', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    const evidencePassages = [{ artifactId: 'policy-1', sourcePath: 'governance/deployment.md', text: 'Every deployment must be approved.', signal: 'obligation' as const }]

    await store.savePolicyGateEvaluations([{
      id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy', severity: 'high', title: 'Missing deployment guard', detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, evidencePassages, recommendation: 'Add a deployment gate', reviewStatus: 'proposed', createdAt: '2026-10-08T00:00:00.000Z',
    }])

    expect(String(query.mock.calls[0][0])).toContain('evidence_passages')
    expect(query.mock.calls[0][1][12]).toBe(JSON.stringify(evidencePassages))
  })

  it('atomically rejects a review when a newer analysis revision wins the race', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    }

    await expect(store.reviewPolicyGateEvaluation('evaluation-1', 'tenant-1', {
      status: 'accepted',
      reviewedBy: 'reviewer-1',
    }, 'revision-1')).resolves.toBeUndefined()

    const [statement, parameters] = query.mock.calls[1]
    expect(String(statement)).toContain('evaluation.revision=$6')
    expect(String(statement)).toContain('repository.last_scan_revision=$6')
    expect(String(statement)).toContain('FOR UPDATE')
    expect(parameters[5]).toBe('revision-1')
    expect(query).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledOnce()
  })
})
