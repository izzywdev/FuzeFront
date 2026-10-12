import { describe, expect, it, vi } from 'vitest'
import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { repositoryFlowDetail } from './repository-flow-detail'

const repository = { id: 'repo-1', tenantId: 'tenant-1' } as Repository
const candidate = {
  id: 'flow-1', repositoryId: 'repo-1', tenantId: 'tenant-1',
} as RepositoryFlowCandidate

describe('repository flow detail', () => {
  it('loads a candidate only after resolving the repository in the caller tenant', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      candidates: vi.fn().mockResolvedValue([candidate]),
    }

    await expect(repositoryFlowDetail('repo-1', 'tenant-1', 'flow-1', dependencies))
      .resolves.toEqual({ status: 200, candidate })
    expect(dependencies.repository).toHaveBeenCalledWith('repo-1', 'tenant-1')
    expect(dependencies.candidates).toHaveBeenCalledWith('repo-1', 'tenant-1', {
      id: 'flow-1',
      limit: 1,
    })
  })

  it('does not query candidates when the tenant does not own the repository', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(undefined),
      candidates: vi.fn(),
    }

    await expect(repositoryFlowDetail('repo-1', 'tenant-2', 'flow-1', dependencies))
      .resolves.toEqual({ status: 404, error: 'Repository not found' })
    expect(dependencies.candidates).not.toHaveBeenCalled()
  })

  it('rejects a mismatched candidate even if a store returns it', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      candidates: vi.fn().mockResolvedValue([
        { ...candidate, repositoryId: 'repo-2', tenantId: 'tenant-2' },
      ]),
    }

    await expect(repositoryFlowDetail('repo-1', 'tenant-1', 'flow-1', dependencies))
      .resolves.toEqual({ status: 404, error: 'Flow candidate not found' })
  })
})
