import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'

type FlowDetailDependencies = {
  repository: (repositoryId: string, tenantId: string) => Promise<Repository | undefined>
  candidates: (repositoryId: string, tenantId: string) => Promise<RepositoryFlowCandidate[]>
}

export type RepositoryFlowDetailResult =
  | { status: 200; candidate: RepositoryFlowCandidate }
  | { status: 404; error: 'Repository not found' | 'Flow candidate not found' }

/**
 * Resolves a flow through the caller's FuzeFront tenant boundary. The explicit
 * ownership check is defense in depth for store implementations and fixtures:
 * a candidate returned from another repository or tenant is never disclosed.
 */
export async function repositoryFlowDetail(
  repositoryId: string,
  tenantId: string,
  candidateId: string,
  dependencies: FlowDetailDependencies,
): Promise<RepositoryFlowDetailResult> {
  if (!await dependencies.repository(repositoryId, tenantId)) {
    return { status: 404, error: 'Repository not found' }
  }
  const candidate = (await dependencies.candidates(repositoryId, tenantId))
    .find(item =>
      item.id === candidateId &&
      item.repositoryId === repositoryId &&
      item.tenantId === tenantId
    )
  return candidate
    ? { status: 200, candidate }
    : { status: 404, error: 'Flow candidate not found' }
}
