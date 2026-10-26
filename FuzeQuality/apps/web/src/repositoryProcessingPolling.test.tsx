// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Portfolio, RepositoryProcessingStatus } from '@fuzequality/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Repositories } from './App'
import { api } from './api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('repository processing polling', () => {
  it('requests lightweight status while a scan or reviewed analysis is active', async () => {
    const status: RepositoryProcessingStatus = {
      id: 'repo-1', lastScanStatus: 'complete', lastScanRevision: 'abc',
      lastAnalysis: { revision: 'abc', status: 'running' },
    }
    vi.spyOn(api, 'repositoryProcessingStatus').mockResolvedValue(status)
    const updateProcessingStatus = vi.fn()
    const data: Portfolio = {
      repositories: [{
        id: 'repo-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front', defaultBranch: 'main',
        kind: 'application', includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true,
        lastScanStatus: 'complete', lastScanRevision: 'abc', lastAnalysis: { revision: 'abc', status: 'queued' },
      }],
      operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [], requirements: [], flows: [], suggestions: [],
    }

    render(<Repositories data={data} reload={vi.fn()} updateProcessingStatus={updateProcessingStatus} />)

    await waitFor(() => expect(api.repositoryProcessingStatus).toHaveBeenCalledWith('repo-1'))
    expect(updateProcessingStatus).toHaveBeenCalledWith(status)
  })

  it('reloads the catalog once repository processing reaches a terminal state', async () => {
    const status: RepositoryProcessingStatus = {
      id: 'repo-1', lastScanStatus: 'complete', lastScanRevision: 'new-catalog',
      lastAnalysis: { revision: 'new-catalog', status: 'queued' },
    }
    vi.spyOn(api, 'repositoryProcessingStatus').mockResolvedValue(status)
    const reload = vi.fn().mockResolvedValue(undefined)
    const data: Portfolio = {
      repositories: [{
        id: 'repo-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front', defaultBranch: 'main',
        kind: 'application', includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true,
        lastScanStatus: 'running', lastScanRevision: 'old-catalog',
      }],
      operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [], requirements: [], flows: [], suggestions: [],
    }

    render(<Repositories data={data} reload={reload} updateProcessingStatus={vi.fn()} />)

    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it('requeues failed analysis and immediately projects its queued status', async () => {
    const queued: RepositoryProcessingStatus = {
      id: 'repo-1', lastScanStatus: 'complete', lastScanRevision: 'abc',
      lastAnalysis: { revision: 'abc', status: 'queued' },
    }
    vi.spyOn(api, 'retryRepositoryAnalysis').mockResolvedValue(queued)
    const updateProcessingStatus = vi.fn()
    const data: Portfolio = {
      repositories: [{
        id: 'repo-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front', defaultBranch: 'main',
        kind: 'application', includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true,
        lastScanStatus: 'complete', lastScanRevision: 'abc', lastAnalysis: { revision: 'abc', status: 'failed' },
      }],
      operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [], requirements: [], flows: [], suggestions: [],
    }

    render(<Repositories data={data} reload={vi.fn()} updateProcessingStatus={updateProcessingStatus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry reviewed analysis' }))

    await waitFor(() => expect(api.retryRepositoryAnalysis).toHaveBeenCalledWith('repo-1'))
    expect(updateProcessingStatus).toHaveBeenCalledWith(queued)
  })

  it('shows a retry failure beside the affected repository without opening onboarding', async () => {
    vi.spyOn(api, 'retryRepositoryAnalysis').mockRejectedValue(new Error('FuzeInfra retry queue unavailable'))
    const data: Portfolio = {
      repositories: [{
        id: 'repo-1', owner: 'fuze', name: 'front', canonicalUrl: 'https://github.com/fuze/front', defaultBranch: 'main',
        kind: 'application', includeGlobs: [], excludeGlobs: [], jiraProjects: [], jiraBindings: [], enabled: true,
        lastScanStatus: 'complete', lastScanRevision: 'abc', lastAnalysis: { revision: 'abc', status: 'failed' },
      }],
      operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [], requirements: [], flows: [], suggestions: [],
    }

    render(<Repositories data={data} reload={vi.fn()} updateProcessingStatus={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry reviewed analysis' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('FuzeInfra retry queue unavailable')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
