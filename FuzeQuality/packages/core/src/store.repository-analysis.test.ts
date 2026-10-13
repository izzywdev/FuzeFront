import { TOPICS, type Repository, type ScanResult } from '@fuzequality/contracts'
import { describe, expect, it, vi } from 'vitest'
import { InProcessEventBus, relayOutboxBatch } from './events'
import { MemoryCatalogStore, PostgresCatalogStore } from './store'

const repository: Repository = {
  id: 'repo-1', tenantId: 'tenant-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front',
  defaultBranch: 'main', kind: 'application', includeGlobs: [], excludeGlobs: [], jiraProjects: [],
  jiraBindings: [], enabled: true, lastScanStatus: 'complete', lastScanRevision: 'catalog-revision',
  lastAnalysis: { revision: 'catalog-revision', status: 'failed', errorCode: 'INTELLIGENCE_UNAVAILABLE' },
}

function seed(repositoryValue: Repository = repository) {
  return {
    repositories: [repositoryValue], operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [],
    requirements: [], flows: [], suggestions: [],
  }
}

describe('repository analysis lifecycle storage', () => {
  it('does not let a delayed prior-revision analysis overwrite the current revision', async () => {
    const store = new MemoryCatalogStore(seed({
        id: 'repo-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front',
        defaultBranch: 'main', kind: 'application', includeGlobs: [], excludeGlobs: [], jiraProjects: [],
        jiraBindings: [], enabled: true, lastScanStatus: 'complete', lastScanRevision: 'new-revision',
        lastAnalysis: { revision: 'new-revision', status: 'queued' },
      }))

    await store.setRepositoryAnalysis('repo-1', { revision: 'old-revision', status: 'complete', counts: { deterministic: 1, evaluations: 1, proposed: 1 } })
    expect((await store.repository('repo-1'))?.lastAnalysis).toEqual({ revision: 'new-revision', status: 'queued' })
  })

  it('durably requeues only a failed current revision and publishes it once', async () => {
    const store = new MemoryCatalogStore(seed())

    await expect(store.queueRepositoryAnalysis('repo-1', 'tenant-1')).resolves.toMatchObject({
      lastAnalysis: { revision: 'catalog-revision', status: 'queued' },
    })
    await expect(store.queueRepositoryAnalysis('repo-1', 'tenant-1')).resolves.toBeUndefined()

    const bus = new InProcessEventBus()
    await expect(relayOutboxBatch(store, bus)).resolves.toBe(1)
    await expect(relayOutboxBatch(store, bus)).resolves.toBe(0)
    expect(bus.events).toHaveLength(1)
    expect(bus.events[0]).toMatchObject({
      topic: TOPICS.REPOSITORY_INVENTORY_CHANGED,
      key: 'repo-1',
      payload: { repositoryId: 'repo-1', revision: 'catalog-revision' },
    })
  })

  it('commits scan evidence and its analysis trigger through the same durable outbox', async () => {
    const store = new MemoryCatalogStore(seed({ ...repository, lastScanStatus: 'running', lastAnalysis: undefined }))
    const scan: ScanResult = {
      repository, revision: 'new-catalog-revision', scannedAt: '2026-10-13T10:00:00.000Z',
      operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [], qualityArtifacts: [],
      scanDetails: {
        catalogRevision: 'new-catalog-revision', scannerVersion: 'v1', configVersion: 'v1', partial: false, candidates: [],
        counts: { candidates: 0, operations: 0, frontendSurfaces: 0, tests: 0, diagnostics: 0 },
      },
    }

    await store.saveScan(scan)
    const bus = new InProcessEventBus()
    await expect(relayOutboxBatch(store, bus)).resolves.toBe(1)
    expect(bus.events[0]).toMatchObject({
      topic: TOPICS.REPOSITORY_INVENTORY_CHANGED,
      payload: { repositoryId: 'repo-1', revision: 'new-catalog-revision' },
    })
    expect((await store.repository('repo-1', 'tenant-1'))?.lastAnalysis).toEqual({
      revision: 'new-catalog-revision', status: 'queued',
    })
  })

  it('rolls back a Postgres retry if the analysis event cannot be enqueued', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('RETURNING last_scan_revision')) return { rowCount: 1, rows: [{ last_scan_revision: 'catalog-revision' }] }
      if (sql.includes('INSERT INTO fuzequality.outbox_events')) throw new Error('outbox unavailable')
      return { rowCount: 0, rows: [] }
    })
    const release = vi.fn()
    const store = new PostgresCatalogStore('postgres://unused')
    ;(store as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) }

    await expect(store.queueRepositoryAnalysis('repo-1', 'tenant-1')).rejects.toThrow('outbox unavailable')
    expect(query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })
})
