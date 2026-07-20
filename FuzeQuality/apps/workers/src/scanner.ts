import { rm } from 'node:fs/promises'
import { TOPICS, scanRequestedSchema, type Repository, type ScanResult } from '@fuzequality/contracts'
import { scanRepository } from '@fuzequality/scanner'
import { apiRequest, runConsumer } from './runtime'
import { checkoutRepository } from './github'

await runConsumer(
  'fuzequality-scanner-v1',
  [TOPICS.REPOSITORY_SCAN_REQUESTED],
  async (_topic, payload) => {
    const command = scanRequestedSchema.parse(payload)
    const repository = await apiRequest<Repository>(`/api/v1/repositories/${command.repositoryId}`)
    let root = repository.localPath
    let temporary = false
    if (!root) {
      if (!repository.installationId) throw new Error('Repository has no GitHub App installation')
      root = await checkoutRepository({
        owner: repository.owner,
        name: repository.name,
        branch: repository.defaultBranch,
        commitSha: command.commitSha,
        installationId: repository.installationId,
      })
      temporary = true
    }
    try {
      const result = await scanRepository(repository, root)
      await apiRequest<ScanResult>('/api/v1/internal/scans/results', {
        method: 'POST',
        body: JSON.stringify(result),
      })
    } finally {
      if (temporary) await rm(root, { recursive: true, force: true })
    }
  }
)
