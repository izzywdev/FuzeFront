import type { Repository, RepositoryProcessingStatus } from '@fuzequality/contracts'

export function repositoryProcessingStatus(repository: Repository): RepositoryProcessingStatus {
  return {
    id: repository.id,
    lastScanAt: repository.lastScanAt,
    lastScanRevision: repository.lastScanRevision,
    lastScanStatus: repository.lastScanStatus,
    lastScanDetails: repository.lastScanDetails,
    lastAnalysis: repository.lastAnalysis,
  }
}
