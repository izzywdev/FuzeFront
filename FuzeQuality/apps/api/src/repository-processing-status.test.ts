import { describe, expect, it } from 'vitest'
import type { Repository } from '@fuzequality/contracts'
import { repositoryProcessingStatus } from './repository-processing-status'

describe('repository processing status response', () => {
  it('returns lifecycle state without repository configuration or installation metadata', () => {
    const repository: Repository = {
      id: 'repo-1', tenantId: 'tenant-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front',
      defaultBranch: 'main', kind: 'application', installationId: '123', includeGlobs: ['apps/**'], excludeGlobs: [],
      jiraProjects: [], jiraBindings: [], enabled: true, lastScanStatus: 'complete', lastScanRevision: 'abc',
      lastAnalysis: { revision: 'abc', status: 'running' },
    }
    expect(repositoryProcessingStatus(repository)).toEqual({
      id: 'repo-1', lastScanAt: undefined, lastScanRevision: 'abc', lastScanStatus: 'complete',
      lastScanDetails: undefined, lastAnalysis: { revision: 'abc', status: 'running' },
    })
    expect(repositoryProcessingStatus(repository)).not.toHaveProperty('installationId')
  })
})
