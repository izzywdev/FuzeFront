import { describe, expect, it } from 'vitest'
import type { Repository } from '@fuzequality/contracts'
import { applyRepositoryProcessingStatus, repositoryNeedsProcessingPoll } from './repositoryProcessing'

const repository = (overrides: Partial<Repository> = {}): Repository => ({
  id: 'repo-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front', defaultBranch: 'main',
  kind: 'application', includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true,
  lastScanStatus: 'complete', ...overrides,
})

describe('repository processing refresh', () => {
  it('polls only active scan or reviewed-analysis lifecycles', () => {
    expect(repositoryNeedsProcessingPoll(repository({ lastScanStatus: 'queued' }))).toBe(true)
    expect(repositoryNeedsProcessingPoll(repository({ lastAnalysis: { revision: 'abc', status: 'running' } }))).toBe(true)
    expect(repositoryNeedsProcessingPoll(repository({ lastAnalysis: { revision: 'abc', status: 'complete', counts: { deterministic: 1, proposed: 0, evaluations: 2 } } }))).toBe(false)
    expect(repositoryNeedsProcessingPoll(repository({ lastAnalysis: { revision: 'abc', status: 'failed', errorCode: 'INTELLIGENCE_UNAVAILABLE' } }))).toBe(false)
  })

  it('merges lifecycle state without discarding repository administration', () => {
    const current = repository({ ownership: { team: 'quality' }, lastAnalysis: { revision: 'abc', status: 'running' } })
    const updated = applyRepositoryProcessingStatus(current, {
      id: current.id, lastScanStatus: 'complete', lastScanRevision: 'abc',
      lastAnalysis: { revision: 'abc', status: 'complete', counts: { deterministic: 2, proposed: 1, evaluations: 3 } },
    })
    expect(updated.ownership).toEqual({ team: 'quality' })
    expect(updated.lastAnalysis?.status).toBe('complete')
  })
})
