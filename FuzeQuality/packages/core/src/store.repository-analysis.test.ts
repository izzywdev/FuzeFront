import { describe, expect, it } from 'vitest'
import { MemoryCatalogStore } from './store'

describe('repository analysis lifecycle storage', () => {
  it('does not let a delayed prior-revision analysis overwrite the current revision', async () => {
    const store = new MemoryCatalogStore({
      repositories: [{
        id: 'repo-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front',
        defaultBranch: 'main', kind: 'application', includeGlobs: [], excludeGlobs: [], jiraProjects: [],
        jiraBindings: [], enabled: true, lastScanStatus: 'complete', lastScanRevision: 'new-revision',
        lastAnalysis: { revision: 'new-revision', status: 'queued' },
      }],
      operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [],
      requirements: [], flows: [], suggestions: [],
    })

    await store.setRepositoryAnalysis('repo-1', { revision: 'old-revision', status: 'complete', counts: { deterministic: 1, evaluations: 1, proposed: 1 } })
    expect((await store.repository('repo-1'))?.lastAnalysis).toEqual({ revision: 'new-revision', status: 'queued' })
  })
})
