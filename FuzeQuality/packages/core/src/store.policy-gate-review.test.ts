import { describe, expect, it } from 'vitest'
import { MemoryCatalogStore } from './store'

describe('policy-gate review lifecycle', () => {
  it('keeps an explicit review decision when the same revision is re-analysed', async () => {
    const store = new MemoryCatalogStore()
    const evaluation = { id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc', kind: 'unguarded-policy' as const, severity: 'high' as const, title: 'Missing deployment guard', detail: 'No matching gate', policyArtifactIds: ['policy-1'], gateArtifactIds: [], recommendation: 'Add a deployment gate', reviewStatus: 'proposed' as const, createdAt: '2026-10-08T00:00:00.000Z' }
    await store.savePolicyGateEvaluations([evaluation])
    await expect(store.reviewPolicyGateEvaluation(evaluation.id, evaluation.tenantId, { status: 'accepted', reviewedBy: 'user-1', reason: 'Threshold is already enforced elsewhere.' })).resolves.toMatchObject({ reviewStatus: 'accepted', reviewedBy: 'user-1' })
    await store.savePolicyGateEvaluations([evaluation])
    await expect(store.policyGateEvaluations(evaluation.repositoryId, evaluation.tenantId)).resolves.toEqual([expect.objectContaining({ reviewStatus: 'accepted', reviewedAt: expect.any(String), reviewedBy: 'user-1', reviewReason: 'Threshold is already enforced elsewhere.' })])
    await store.reviewPolicyGateEvaluation(evaluation.id, evaluation.tenantId, { status: 'dismissed', reviewedBy: 'user-3', reason: 'The replacement control was removed.' })
    await expect(store.policyGateReviewHistory(evaluation.id, evaluation.tenantId)).resolves.toEqual([
      expect.objectContaining({ status: 'dismissed', reviewedBy: 'user-3', reason: 'The replacement control was removed.', createdAt: expect.any(String) }),
      expect.objectContaining({ status: 'accepted', reviewedBy: 'user-1', reason: 'Threshold is already enforced elsewhere.', createdAt: expect.any(String) }),
    ])
    await expect(store.policyGateReviewHistory(evaluation.id, 'tenant-2')).resolves.toEqual([])
    await expect(store.reviewPolicyGateEvaluation(evaluation.id, 'tenant-2', { status: 'dismissed', reviewedBy: 'user-2' })).resolves.toBeUndefined()
  })
})
