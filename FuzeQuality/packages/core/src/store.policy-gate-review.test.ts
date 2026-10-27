import { describe, expect, it, vi } from 'vitest'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

describe('policy-gate review lifecycle', () => {
  it('paginates tenant-scoped findings with stable timestamp tie-breaking', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, remediationAction: 'build-gate' as const, recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const }
    await store.savePolicyGateEvaluations([
      { ...base, id: 'evaluation-c', title: 'Finding C', policyArtifactIds: ['policy-c'], createdAt: '2026-10-09T00:00:00.000Z' },
      { ...base, id: 'evaluation-b', title: 'Finding B', policyArtifactIds: ['policy-b'], createdAt: '2026-10-09T00:00:00.000Z' },
      { ...base, id: 'evaluation-a', title: 'Finding A', policyArtifactIds: ['policy-a'], createdAt: '2026-10-08T00:00:00.000Z' },
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
    const evaluation = { id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, title: 'Missing deployment guard', detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, remediationAction: 'build-gate' as const, recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const, createdAt: '2026-10-08T00:00:00.000Z' }
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
    expect(history.every(item => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id))).toBe(true)
    await expect(store.policyGateReviewHistory(evaluation.id, evaluation.tenantId, {
      after: { createdAt: history[0].createdAt, id: history[0].id },
      limit: 1,
    })).resolves.toEqual([expect.objectContaining({ reviewedBy: 'user-1' })])
    await expect(store.policyGateReviewHistory(evaluation.id, 'tenant-2')).resolves.toEqual([])
    await expect(store.reviewPolicyGateEvaluation(evaluation.id, 'tenant-2', { status: 'dismissed', reviewedBy: 'user-2' })).resolves.toBeUndefined()
  })

  it('keeps the pagination timestamp immutable when a finding is re-analysed', async () => {
    const store = new MemoryCatalogStore()
    const evaluation = { id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, title: 'Missing deployment guard', detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, remediationAction: 'build-gate' as const, recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const, createdAt: '2026-10-08T00:00:00.000Z' }
    await store.savePolicyGateEvaluations([
      evaluation,
      { ...evaluation, id: 'evaluation-older', title: 'Older finding', policyArtifactIds: ['policy-2'], createdAt: '2026-10-07T00:00:00.000Z' },
    ])

    const [first] = await store.policyGateEvaluations(evaluation.repositoryId, evaluation.tenantId, { limit: 1 })
    await store.savePolicyGateEvaluations([{ ...evaluation, confidence: 0.92, createdAt: '2026-10-10T00:00:00.000Z' }])

    await expect(store.policyGateEvaluations(evaluation.repositoryId, evaluation.tenantId, {
      after: { createdAt: first.createdAt, id: first.id },
      limit: 1,
    })).resolves.toEqual([expect.objectContaining({ id: 'evaluation-older' })])
    await expect(store.policyGateEvaluations(evaluation.repositoryId, evaluation.tenantId, { id: evaluation.id })).resolves.toEqual([
      expect.objectContaining({ confidence: 0.92, createdAt: evaluation.createdAt }),
    ])
  })

  it('persists same-title relationships independently by artifact identity', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'guarded-policy' as const, severity: 'low' as const, title: 'Policy is guarded: security.md / Authentication gate', detail: 'A gate matches.', gateArtifactIds: ['gate-auth'], confidence: 0.9, scope: { sourcePaths: [], subjects: ['authentication'] }, remediationAction: 'align-policy-gate' as const, recommendation: 'Keep aligned.', reviewStatus: 'proposed' as const, createdAt: '2026-10-08T00:00:00.000Z' }
    await store.savePolicyGateEvaluations([
      { ...base, id: 'evaluation-a', policyArtifactIds: ['policy-a'] },
      { ...base, id: 'evaluation-b', policyArtifactIds: ['policy-b'] },
    ])

    const evaluations = await store.policyGateEvaluations('repo-1', 'tenant-1')
    expect(evaluations).toHaveLength(2)
    expect(evaluations.map(item => item.policyArtifactIds).sort()).toEqual([['policy-a'], ['policy-b']])
  })

  it('upserts Postgres relationships by artifact identity instead of title', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    const evaluation = { id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'guarded-policy' as const, severity: 'low' as const, title: 'Policy is guarded', detail: 'A gate matches.', policyArtifactIds: ['policy-b', 'policy-a'], gateArtifactIds: ['gate-b', 'gate-a'], confidence: 0.9, scope: { sourcePaths: [], subjects: [] }, remediationAction: 'align-policy-gate' as const, recommendation: 'Keep aligned.', reviewStatus: 'proposed' as const, createdAt: '2026-10-08T00:00:00.000Z' }

    await store.savePolicyGateEvaluations([evaluation])

    expect(String(query.mock.calls[0][0])).toContain('ON CONFLICT ON CONSTRAINT policy_gate_evaluations_artifact_identity_key')
    expect(String(query.mock.calls[0][0])).not.toContain('kind,title')
    expect(String(query.mock.calls[0][0])).not.toContain('created_at=EXCLUDED.created_at')
    expect(query.mock.calls[0][1][8]).toBe(JSON.stringify(['policy-a', 'policy-b']))
    expect(query.mock.calls[0][1][9]).toBe(JSON.stringify(['gate-a', 'gate-b']))
  })

  it('atomically rejects a policy/gate re-review with an obsolete decision timestamp', async () => {
    const store = new MemoryCatalogStore()
    const evaluation = { id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, title: 'Missing deployment guard', detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, remediationAction: 'build-gate' as const, recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const, createdAt: '2026-10-08T00:00:00.000Z' }
    await store.savePolicyGateEvaluations([evaluation])
    const accepted = await store.reviewPolicyGateEvaluation(evaluation.id, evaluation.tenantId, {
      status: 'accepted', reviewedBy: 'user-1', expectedReviewedAt: null,
    })

    await expect(store.reviewPolicyGateEvaluation(evaluation.id, evaluation.tenantId, {
      status: 'dismissed', reviewedBy: 'user-2', expectedReviewedAt: null,
    })).resolves.toBeUndefined()
    await expect(store.reviewPolicyGateEvaluation(evaluation.id, evaluation.tenantId, {
      status: 'dismissed', reviewedBy: 'user-2', expectedReviewedAt: accepted?.reviewedAt,
    })).resolves.toMatchObject({ reviewStatus: 'dismissed', reviewedBy: 'user-2' })
    await expect(store.policyGateReviewHistory(evaluation.id, evaluation.tenantId)).resolves.toHaveLength(2)
  })

  it('filters policy findings by remediation, inclusive confidence bounds, and tenant', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, remediationAction: 'build-gate' as const, recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const, createdAt: '2026-10-09T00:00:00.000Z' }
    await store.savePolicyGateEvaluations([
      { ...base, id: 'low', title: 'Low confidence', policyArtifactIds: ['policy-low'], confidence: 0.69 },
      { ...base, id: 'minimum', title: 'Minimum confidence', policyArtifactIds: ['policy-minimum'], confidence: 0.7 },
      { ...base, id: 'maximum', title: 'Maximum confidence', policyArtifactIds: ['policy-maximum'], confidence: 0.9 },
      { ...base, id: 'other-subject', title: 'Other subject', policyArtifactIds: ['policy-other-subject'], confidence: 0.8, scope: { sourcePaths: ['governance/authentication.md'], subjects: ['authentication'] } },
      { ...base, id: 'other-remediation', title: 'Other remediation', policyArtifactIds: ['policy-other-remediation'], confidence: 0.8, remediationAction: 'disambiguate-policy' },
      { ...base, id: 'high', title: 'High confidence', policyArtifactIds: ['policy-high'], confidence: 0.91 },
      { ...base, id: 'other-tenant', tenantId: 'tenant-2', title: 'Other tenant', confidence: 0.8 },
    ])

    const matches = await store.policyGateEvaluations('repo-1', 'tenant-1', {
      minConfidence: 0.7,
      maxConfidence: 0.9,
      subject: 'DEPLOYMENT',
      remediationAction: 'build-gate',
    })
    expect(matches.map(item => item.id).sort()).toEqual(['maximum', 'minimum'])
  })

  it('filters exact policy and gate relationships without crossing tenants', async () => {
    const store = new MemoryCatalogStore()
    const base = { repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'guarded-policy' as const, severity: 'low' as const, detail: 'A gate matches.', confidence: 0.9, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, remediationAction: 'align-policy-gate' as const, recommendation: 'Keep aligned.', reviewStatus: 'proposed' as const, createdAt: '2026-10-09T00:00:00.000Z' }
    await store.savePolicyGateEvaluations([
      { ...base, id: 'target', title: 'Target pair', policyArtifactIds: ['policy-target'], gateArtifactIds: ['gate-target'] },
      { ...base, id: 'other-policy', title: 'Other policy', policyArtifactIds: ['policy-other'], gateArtifactIds: ['gate-target'] },
      { ...base, id: 'other-gate', title: 'Other gate', policyArtifactIds: ['policy-target'], gateArtifactIds: ['gate-other'] },
      { ...base, id: 'other-tenant', tenantId: 'tenant-2', title: 'Other tenant', policyArtifactIds: ['policy-target'], gateArtifactIds: ['gate-target'] },
    ])

    await expect(store.policyGateEvaluations('repo-1', 'tenant-1', {
      policyArtifactId: 'policy-target',
      gateArtifactId: 'gate-target',
    })).resolves.toEqual([expect.objectContaining({ id: 'target' })])
  })

  it('binds policy confidence before the stable Postgres continuation cursor', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }

    await store.policyGateEvaluations('repo-1', 'tenant-1', {
      remediationAction: 'build-gate',
      minConfidence: 0.7,
      maxConfidence: 0.9,
      subject: 'Deployment',
      policyArtifactId: 'policy-1',
      gateArtifactId: 'gate-1',
      after: { createdAt: '2026-10-09T00:00:00.000Z', id: 'evaluation-1' },
      limit: 25,
    })

    const [statement, parameters] = query.mock.calls[0]
    expect(String(statement)).toContain('confidence >= $8')
    expect(String(statement)).toContain('confidence <= $9')
    expect(String(statement)).toContain('(created_at,id) < ($10::timestamptz,$11::text)')
    expect(String(statement)).toContain("jsonb_array_elements_text(COALESCE(scope->'subjects', '[]'::jsonb))")
    expect(String(statement)).toContain('lower(scoped_subject.value)=lower($13)')
    expect(String(statement)).toContain('remediation_action=$14')
    expect(String(statement)).toContain("jsonb_array_elements_text(COALESCE(policy_artifact_ids, '[]'::jsonb))")
    expect(String(statement)).toContain('policy_artifact.value=$15')
    expect(String(statement)).toContain("jsonb_array_elements_text(COALESCE(gate_artifact_ids, '[]'::jsonb))")
    expect(String(statement)).toContain('gate_artifact.value=$16')
    expect(parameters).toEqual([
      'repo-1', 'tenant-1', null, null, null, null, null,
      0.7, 0.9, '2026-10-09T00:00:00.000Z', 'evaluation-1', 25, 'Deployment', 'build-gate', 'policy-1', 'gate-1',
    ])
  })

  it('persists exact evidence passages with the deterministic evaluation', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { query }
    const evidencePassages = [{ artifactId: 'policy-1', sourcePath: 'governance/deployment.md', text: 'Every deployment must be approved.', signal: 'obligation' as const }]

    await store.savePolicyGateEvaluations([{
      id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy', severity: 'high', title: 'Missing deployment guard', detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], confidence: 0.75, scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, evidencePassages, remediationAction: 'build-gate', recommendation: 'Add a deployment gate', reviewStatus: 'proposed', createdAt: '2026-10-08T00:00:00.000Z',
    }])

    expect(String(query.mock.calls[0][0])).toContain('evidence_passages')
    expect(String(query.mock.calls[0][0])).toContain('remediation_action')
    expect(query.mock.calls[0][1][12]).toBe(JSON.stringify(evidencePassages))
    expect(query.mock.calls[0][1][13]).toBe('build-gate')
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
      expectedReviewedAt: '2026-10-15T01:00:00.000Z',
    }, 'revision-1')).resolves.toBeUndefined()

    const [statement, parameters] = query.mock.calls[1]
    expect(String(statement)).toContain('evaluation.revision=$6')
    expect(String(statement)).toContain('repository.last_scan_revision=$6')
    expect(String(statement)).toContain('FOR UPDATE')
    expect(String(statement)).toContain("date_trunc('milliseconds', evaluation.reviewed_at)")
    expect(String(statement)).toContain("date_trunc('milliseconds', $8::timestamptz)")
    expect(parameters[5]).toBe('revision-1')
    expect(parameters.slice(6)).toEqual([true, '2026-10-15T01:00:00.000Z'])
    expect(query).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledOnce()
  })

  it('uses database-compatible UUIDs for governance review history and its cursor', async () => {
    const createdAt = new Date('2026-10-08T00:00:00.000Z')
    const reviewedAt = new Date('2026-10-09T01:00:00.000Z')
    const query = vi.fn().mockImplementation(async (statement: string) => {
      if (statement.includes('UPDATE fuzequality.policy_gate_evaluations')) {
        return { rows: [{
          id: 'evaluation-1', repository_id: 'repo-1', tenant_id: 'tenant-1', revision: 'abc',
          kind: 'unguarded-policy', severity: 'high', title: 'Missing deployment guard', detail: 'No matching gate',
          policy_artifact_ids: ['policy-1'], gate_artifact_ids: [], confidence: 0.75,
          scope: { sourcePaths: ['governance/deployment.md'], subjects: ['deployment'] }, evidence_passages: [],
          remediation_action: 'build-gate',
          recommendation: 'Add a deployment gate', review_status: 'accepted', reviewed_at: reviewedAt,
          reviewed_by: 'reviewer-1', review_reason: null, created_at: createdAt,
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

    await store.reviewPolicyGateEvaluation('evaluation-1', 'tenant-1', {
      status: 'accepted', reviewedBy: 'reviewer-1',
    })
    const historyInsert = query.mock.calls.find(([statement]) =>
      String(statement).includes('INSERT INTO fuzequality.policy_gate_review_history')
    )
    expect(historyInsert?.[1][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

    const cursorId = '00000000-0000-4000-8000-000000000002'
    await store.policyGateReviewHistory('evaluation-1', 'tenant-1', {
      after: { createdAt: createdAt.toISOString(), id: cursorId }, limit: 25,
    })
    const historyQuery = query.mock.calls.at(-1)
    expect(String(historyQuery?.[0])).toContain('($3::timestamptz,$4::uuid)')
    expect(historyQuery?.[1]).toEqual(['evaluation-1', 'tenant-1', createdAt.toISOString(), cursorId, 25])
  })
})
