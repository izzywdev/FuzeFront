import type { Repository, TestExecution, TestExecutionDetail } from '@fuzequality/contracts'
import type { TestExecutionQuery } from '@fuzequality/core'

type TestExecutionDetailDependencies = {
  repository: (repositoryId: string, tenantId: string) => Promise<Repository | undefined>
  executions: TestExecutionLookup
  catalogRevisionForSource: (
    repositoryId: string,
    tenantId: string,
    sourceRevision: string,
  ) => Promise<string | undefined>
}

export type TestExecutionLookup = (
  repositoryId: string,
  tenantId: string,
  query: TestExecutionQuery,
) => Promise<TestExecution[]>

export type TestExecutionDetailResult =
  | { status: 200; execution: TestExecutionDetail }
  | { status: 404; error: 'Repository not found' | 'Test execution not found' }

/** Resolve one retained execution without crossing its repository or FuzeFront tenant boundary. */
export async function testExecutionDetail(
  repositoryId: string,
  tenantId: string,
  executionId: string,
  dependencies: TestExecutionDetailDependencies,
): Promise<TestExecutionDetailResult> {
  if (!await dependencies.repository(repositoryId, tenantId)) {
    return { status: 404, error: 'Repository not found' }
  }
  const execution = (await dependencies.executions(repositoryId, tenantId, {
    id: executionId,
    limit: 1,
  }))[0]
  if (
    !execution ||
    execution.id !== executionId ||
    execution.repositoryId !== repositoryId ||
    execution.tenantId !== tenantId
  ) {
    return { status: 404, error: 'Test execution not found' }
  }
  const catalogRevision = await dependencies.catalogRevisionForSource(
    repositoryId,
    tenantId,
    execution.revision,
  )
  return {
    status: 200,
    execution: { ...execution, ...(catalogRevision ? { catalogRevision } : {}) },
  }
}
