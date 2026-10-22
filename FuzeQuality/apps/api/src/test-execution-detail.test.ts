import { describe, expect, it, vi } from 'vitest'
import type { Repository, TestExecution } from '@fuzequality/contracts'
import { testExecutionDetail } from './test-execution-detail'

const repository = { id: 'repo-1', tenantId: 'tenant-1' } as Repository
const execution = {
  id: 'execution-1', repositoryId: 'repo-1', tenantId: 'tenant-1',
  revision: 'source-revision-1',
} as TestExecution

describe('test execution detail', () => {
  it('loads one exact execution after proving repository ownership', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      executions: vi.fn().mockResolvedValue([execution]),
      catalogRevisionForSource: vi.fn().mockResolvedValue('catalog-revision-1'),
    }

    await expect(testExecutionDetail('repo-1', 'tenant-1', 'execution-1', dependencies))
      .resolves.toEqual({
        status: 200,
        execution: { ...execution, catalogRevision: 'catalog-revision-1' },
      })
    expect(dependencies.executions).toHaveBeenCalledWith('repo-1', 'tenant-1', {
      id: 'execution-1',
      limit: 1,
    })
    expect(dependencies.catalogRevisionForSource).toHaveBeenCalledWith(
      'repo-1',
      'tenant-1',
      execution.revision,
    )
  })

  it('keeps an execution inspectable when its source revision has no analyzed catalog', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      executions: vi.fn().mockResolvedValue([execution]),
      catalogRevisionForSource: vi.fn().mockResolvedValue(undefined),
    }

    await expect(testExecutionDetail('repo-1', 'tenant-1', 'execution-1', dependencies))
      .resolves.toEqual({ status: 200, execution })
  })

  it('does not query execution evidence for an unowned repository', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(undefined),
      executions: vi.fn(),
      catalogRevisionForSource: vi.fn(),
    }

    await expect(testExecutionDetail('repo-1', 'tenant-2', 'execution-1', dependencies))
      .resolves.toEqual({ status: 404, error: 'Repository not found' })
    expect(dependencies.executions).not.toHaveBeenCalled()
    expect(dependencies.catalogRevisionForSource).not.toHaveBeenCalled()
  })

  it('rejects a mismatched execution returned by a store', async () => {
    const dependencies = {
      repository: vi.fn().mockResolvedValue(repository),
      executions: vi.fn().mockResolvedValue([
        { ...execution, repositoryId: 'repo-2', tenantId: 'tenant-2' },
      ]),
      catalogRevisionForSource: vi.fn(),
    }

    await expect(testExecutionDetail('repo-1', 'tenant-1', 'execution-1', dependencies))
      .resolves.toEqual({ status: 404, error: 'Test execution not found' })
    expect(dependencies.catalogRevisionForSource).not.toHaveBeenCalled()
  })
})
