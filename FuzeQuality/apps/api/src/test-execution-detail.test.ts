import { describe, expect, it, vi } from 'vitest'
import type { Repository, TestExecution } from '@fuzequality/contracts'
import { testExecutionDetail } from './test-execution-detail'

const repository = { id: 'repo-1', tenantId: 'tenant-1' } as Repository
const execution = {
  id: 'execution-1', repositoryId: 'repo-1', tenantId: 'tenant-1',
} as TestExecution

describe('test execution detail', () => {
  it('loads one exact execution after proving repository ownership', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      executions: vi.fn().mockResolvedValue([execution]),
    }

    await expect(testExecutionDetail('repo-1', 'tenant-1', 'execution-1', dependencies))
      .resolves.toEqual({ status: 200, execution })
    expect(dependencies.executions).toHaveBeenCalledWith('repo-1', 'tenant-1', {
      id: 'execution-1',
      limit: 1,
    })
  })

  it('does not query execution evidence for an unowned repository', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(undefined),
      executions: vi.fn(),
    }

    await expect(testExecutionDetail('repo-1', 'tenant-2', 'execution-1', dependencies))
      .resolves.toEqual({ status: 404, error: 'Repository not found' })
    expect(dependencies.executions).not.toHaveBeenCalled()
  })

  it('rejects a mismatched execution returned by a store', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      executions: vi.fn().mockResolvedValue([
        { ...execution, repositoryId: 'repo-2', tenantId: 'tenant-2' },
      ]),
    }

    await expect(testExecutionDetail('repo-1', 'tenant-1', 'execution-1', dependencies))
      .resolves.toEqual({ status: 404, error: 'Test execution not found' })
  })
})
