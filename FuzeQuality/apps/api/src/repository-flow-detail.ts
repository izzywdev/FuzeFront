import type { Repository, RepositoryFlowCandidate } from '@fuzequality/contracts'
import type { RepositoryFlowCandidateQuery } from '@fuzequality/core'

type FlowDetailDependencies = {
  repository: (repositoryId: string, tenantId: string) => Promise<Repository | undefined>
  candidates: RepositoryFlowCandidateLookup
}

export type RepositoryFlowCandidateLookup = (
  repositoryId: string,
  tenantId: string,
  query: RepositoryFlowCandidateQuery,
) => Promise<RepositoryFlowCandidate[]>

export type RepositoryFlowDetailResult =
  | { status: 200; candidate: RepositoryFlowCandidate }
  | { status: 404; error: 'Repository not found' | 'Flow candidate not found' }

export async function repositoryFlowCandidateById(
  repositoryId: string,
  tenantId: string,
  candidateId: string,
  candidates: RepositoryFlowCandidateLookup,
): Promise<RepositoryFlowCandidate | undefined> {
  const candidate = (await candidates(repositoryId, tenantId, {
    id: candidateId,
    limit: 1,
  }))[0]
  return candidate &&
    candidate.id === candidateId &&
    candidate.repositoryId === repositoryId &&
    candidate.tenantId === tenantId
    ? candidate
    : undefined
}

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
  const candidate = await repositoryFlowCandidateById(
    repositoryId,
    tenantId,
    candidateId,
    dependencies.candidates,
  )
  return candidate
    ? { status: 200, candidate }
    : { status: 404, error: 'Flow candidate not found' }
}
