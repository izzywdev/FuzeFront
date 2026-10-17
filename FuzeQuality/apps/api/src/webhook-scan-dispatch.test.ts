import { describe, expect, it, vi } from 'vitest'
import type { Repository } from '@fuzequality/contracts'
import { InProcessEventBus, MemoryCatalogStore } from '@fuzequality/core'
import { dispatchWebhookScans } from './webhook-scan-dispatch'

const repository: Repository = {
  id: 'b4908e35-8a57-4c13-9366-489ec59071fe', tenantId: 'tenant-1', owner: 'fuze', name: 'front',
  canonicalUrl: 'https://github.com/fuze/front', defaultBranch: 'main', kind: 'application', installationId: '42',
  includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete',
}

const seed = () => ({
  repositories: [{ ...repository }], operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [],
  requirements: [], flows: [], suggestions: [],
})

describe('webhook scan dispatch', () => {
  it('marks default-branch push scans queued before publishing their exact revision', async () => {
    const store = new MemoryCatalogStore(seed())
    const events = new InProcessEventBus()
    const repositoryAccess = { verify: vi.fn() }

    await expect(dispatchWebhookScans([{
      repositoryId: repository.id, commitSha: 'a'.repeat(40), trigger: 'push',
    }], [repository], { store, events, repositoryAccess })).resolves.toBe(1)

    expect((await store.repository(repository.id, 'tenant-1'))?.lastScanStatus).toBe('queued')
    expect(repositoryAccess.verify).not.toHaveBeenCalled()
    expect(events.events).toEqual([expect.objectContaining({
      key: repository.id,
      payload: { repositoryId: repository.id, commitSha: 'a'.repeat(40), trigger: 'push' },
    })])
  })

  it('keeps an oversized webhook scan failure visible after resolving a reconcile revision', async () => {
    const store = new MemoryCatalogStore(seed())
    const events = new InProcessEventBus()
    const repositoryAccess = { verify: vi.fn().mockResolvedValue({ commitSha: 'b'.repeat(40) }) }

    await dispatchWebhookScans([{
      repositoryId: repository.id, trigger: 'reconcile',
    }], [repository], { store, events, repositoryAccess: repositoryAccess as never })
    await store.setRepositoryScanFailure(repository.id, {
      code: 'SCAN_TRANSPORT_LIMIT_EXCEEDED',
      message: 'Narrow the include globs and retry.',
      sourceRevision: 'b'.repeat(40),
      observedBytes: 4_600_000,
      maxBytes: 4_500_000,
      failedAt: '2026-10-15T18:30:00.000Z',
    })

    expect(await store.repository(repository.id, 'tenant-1')).toMatchObject({
      lastScanStatus: 'failed',
      lastScanFailure: { code: 'SCAN_TRANSPORT_LIMIT_EXCEEDED', sourceRevision: 'b'.repeat(40) },
    })
    expect(repositoryAccess.verify).toHaveBeenCalledWith(expect.objectContaining({ installationId: '42' }))
  })
})
