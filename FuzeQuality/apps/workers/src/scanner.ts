import { rm } from 'node:fs/promises'
import { TOPICS, scanRequestedSchema, type Repository, type ScanResult } from '@fuzequality/contracts'
import { scanRepository } from '@fuzequality/scanner'
import { apiRequest, runConsumer } from './runtime'
import { checkoutRepository } from './github'

await runConsumer(
  'fuzequality-scanner-v1',
  [TOPICS.REPOSITORY_SCAN_REQUESTED],
  async (_topic, payload, _correlationId, { heartbeat }) => {
    const command = scanRequestedSchema.parse(payload)
    const repository = await apiRequest<Repository>(`/api/v1/internal/repositories/${command.repositoryId}`)
    let root = repository.localPath
    let temporary = false
    if (!root) {
      if (!repository.installationId) throw new Error('Repository has no GitHub App installation')
      root = await checkoutRepository({
        owner: repository.owner,
        name: repository.name,
        commitSha: command.commitSha ?? '',
        installationId: repository.installationId,
        onMetrics: metrics => console.info(JSON.stringify({ event: 'repository_checkout', ...metrics })),
      })
      temporary = true
    }
    try {
      const result = await scanRepository(repository, root, { onProgress: heartbeat })
      await apiRequest<ScanResult>('/api/v1/internal/scans/results', {
        method: 'POST',
        body: JSON.stringify(result),
      })
    } finally {
      if (temporary) await rm(root, { recursive: true, force: true })
    }
  }
)
