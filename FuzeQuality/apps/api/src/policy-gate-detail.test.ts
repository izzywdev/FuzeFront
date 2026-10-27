import { describe, expect, it, vi } from 'vitest'
import type { PolicyGateEvaluation, Repository } from '@fuzequality/contracts'
import { policyGateDetail } from './policy-gate-detail'

const repository = { id: 'repo-1', tenantId: 'tenant-1' } as Repository
const evaluation = {
  id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1',
} as PolicyGateEvaluation

describe('policy/gate evaluation detail', () => {
  it('loads an evaluation only after resolving the repository in the caller tenant', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      evaluations: vi.fn().mockResolvedValue([evaluation]),
    }

    await expect(policyGateDetail('repo-1', 'tenant-1', 'evaluation-1', dependencies))
      .resolves.toEqual({ status: 200, evaluation })
    expect(dependencies.repository).toHaveBeenCalledWith('repo-1', 'tenant-1')
    expect(dependencies.evaluations).toHaveBeenCalledWith('repo-1', 'tenant-1', {
      id: 'evaluation-1',
      limit: 1,
    })
  })

  it('does not query evaluations when the tenant does not own the repository', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(undefined),
      evaluations: vi.fn(),
    }

    await expect(policyGateDetail('repo-1', 'tenant-2', 'evaluation-1', dependencies))
      .resolves.toEqual({ status: 404, error: 'Repository not found' })
    expect(dependencies.evaluations).not.toHaveBeenCalled()
  })

  it('rejects a mismatched evaluation even if a store returns it', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      evaluations: vi.fn().mockResolvedValue([
        { ...evaluation, repositoryId: 'repo-2', tenantId: 'tenant-2' },
      ]),
    }

    await expect(policyGateDetail('repo-1', 'tenant-1', 'evaluation-1', dependencies))
      .resolves.toEqual({ status: 404, error: 'Policy-gate evaluation not found' })
  })
})
