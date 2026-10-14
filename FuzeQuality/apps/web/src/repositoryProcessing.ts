import type { Repository, RepositoryProcessingStatus } from '@fuzequality/contracts'

export function repositoryProcessingStatusNeedsPoll(
  status: Pick<Repository, 'lastScanStatus' | 'lastAnalysis'> | RepositoryProcessingStatus,
) {
  return status.lastScanStatus === 'queued' || status.lastScanStatus === 'running' ||
    status.lastAnalysis?.status === 'queued' || status.lastAnalysis?.status === 'running'
}

export function repositoryNeedsProcessingPoll(repository: Repository) {
  return repositoryProcessingStatusNeedsPoll(repository)
}

export function repositoryProcessingTransitionCompleted(
  repository: Repository,
  status: RepositoryProcessingStatus,
) {
  const scanWasActive = repository.lastScanStatus === 'queued' || repository.lastScanStatus === 'running'
  const scanIsActive = status.lastScanStatus === 'queued' || status.lastScanStatus === 'running'
  const analysisWasActive = repository.lastAnalysis?.status === 'queued' || repository.lastAnalysis?.status === 'running'
  const analysisIsActive = status.lastAnalysis?.status === 'queued' || status.lastAnalysis?.status === 'running'
  return (scanWasActive && !scanIsActive) || (analysisWasActive && !analysisIsActive)
}

export function applyRepositoryProcessingStatus(repository: Repository, status: RepositoryProcessingStatus): Repository {
  if (repository.id !== status.id) return repository
  return { ...repository, ...status }
}
