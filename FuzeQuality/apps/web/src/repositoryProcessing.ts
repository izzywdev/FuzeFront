import type { Repository, RepositoryProcessingStatus } from '@fuzequality/contracts'

export function repositoryNeedsProcessingPoll(repository: Repository) {
  return repository.lastScanStatus === 'queued' || repository.lastScanStatus === 'running' ||
    repository.lastAnalysis?.status === 'queued' || repository.lastAnalysis?.status === 'running'
}

export function applyRepositoryProcessingStatus(repository: Repository, status: RepositoryProcessingStatus): Repository {
  if (repository.id !== status.id) return repository
  return { ...repository, ...status }
}
