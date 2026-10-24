import { TOPICS, type Repository } from '@fuzequality/contracts'
import type { ScanCommand } from '@fuzequality/github-app'
import type { CatalogStore, EventBus } from '@fuzequality/core'
import type { RepositoryAccessVerifier } from './repository-onboarding'

type WebhookScanDependencies = {
  store: Pick<CatalogStore, 'setRepositoryStatus'>
  repositoryAccess: RepositoryAccessVerifier
  events: EventBus
}

/**
 * Resolve and publish webhook-driven scans while making their lifecycle visible
 * to polling clients before the asynchronous worker can complete or fail.
 */
export async function dispatchWebhookScans(
  commands: ScanCommand[],
  repositories: Repository[],
  dependencies: WebhookScanDependencies,
) {
  let queued = 0
  for (const command of commands) {
    const repository = repositories.find(item => item.id === command.repositoryId)
    if (!repository) continue
    let commitSha = command.commitSha
    if (!commitSha) {
      if (!repository.installationId) continue
      try {
        const access = await dependencies.repositoryAccess.verify({
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
          installationId: repository.installationId,
        })
        commitSha = access.commitSha
      } catch {
        // One tenant's stale installation binding must not prevent other
        // onboarded copies of the same GitHub repository from reconciling.
        // Keep this repository's failure visible to frontend polling without
        // exposing provider diagnostics in shared catalog state.
        await dependencies.store.setRepositoryStatus(repository.id, 'failed')
        continue
      }
    }

    await dependencies.store.setRepositoryStatus(repository.id, 'queued')
    try {
      await dependencies.events.publish(
        TOPICS.REPOSITORY_SCAN_REQUESTED,
        { ...command, commitSha },
        repository.id,
      )
      queued += 1
    } catch (error) {
      await dependencies.store.setRepositoryStatus(repository.id, 'failed')
      throw error
    }
  }
  return queued
}
