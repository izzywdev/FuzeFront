import { rm } from 'node:fs/promises'
import { TOPICS, scanRequestedSchema, type Repository, type ScanResult } from '@fuzequality/contracts'
import { ScanTransportLimitError, scanRepository } from '@fuzequality/scanner'
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
      const heartbeatTimer = setInterval(() => {
        void heartbeat().catch(error => {
          console.warn(JSON.stringify({
            event: 'repository_scan_heartbeat',
            outcome: 'failed',
            repository: `${repository.owner}/${repository.name}`,
            error: error instanceof Error ? error.message : String(error),
          }))
        })
      }, 3_000)
      try {
        try {
          const result = await scanRepository(repository, root, {
            onProgress: heartbeat,
            sourceRevision: command.commitSha,
            trigger: command.trigger,
          })
          await apiRequest<ScanResult>('/api/v1/internal/scans/results', {
            method: 'POST',
            body: JSON.stringify(result),
          })
        } catch (error) {
          if (!(error instanceof ScanTransportLimitError)) throw error
          await apiRequest(`/api/v1/internal/repositories/${repository.id}/scan-failure`, {
            method: 'POST',
            body: JSON.stringify({
              code: error.code,
              message: 'Repository inventory exceeds the safe ingestion limit. Narrow the repository include globs and retry.',
              sourceRevision: command.commitSha,
              observedBytes: error.observedBytes,
              maxBytes: error.maxBytes,
              failedAt: new Date().toISOString(),
            }),
          })
        }
      } finally {
        clearInterval(heartbeatTimer)
      }
    } finally {
      if (temporary) await rm(root, { recursive: true, force: true })
    }
  },
  {
    onExhausted: async (_topic, payload) => {
      const parsed = scanRequestedSchema.safeParse(payload)
      if (!parsed.success) return
      await apiRequest(`/api/v1/internal/repositories/${parsed.data.repositoryId}/scan-failure`, {
        method: 'POST',
        body: JSON.stringify({
          code: 'SCAN_PROCESSING_FAILED',
          message: 'Repository analysis could not complete after bounded worker retries. Review worker diagnostics and retry the scan.',
          sourceRevision: parsed.data.commitSha,
          failedAt: new Date().toISOString(),
        }),
      })
    },
  },
)
