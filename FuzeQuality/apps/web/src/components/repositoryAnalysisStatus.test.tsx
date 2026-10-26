// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepositoryAnalysisStatus } from './repositoryAnalysisStatus'

afterEach(cleanup)

describe('RepositoryAnalysisStatus', () => {
  it('shows reviewed evidence counts for a completed revision', () => {
    render(<RepositoryAnalysisStatus analysis={{ revision: 'abcdef1234567890', status: 'complete', counts: { deterministic: 4, proposed: 2, evaluations: 3 } }} />)
    expect(screen.getByLabelText('Repository analysis status')).toHaveTextContent('analysis complete')
    expect(screen.getByLabelText('Repository analysis status')).toHaveTextContent('4 detected · 2 AI proposals · 3 policy checks')
  })

  it('explains a safe failure without hiding deterministic evidence', () => {
    const retry = vi.fn()
    render(<RepositoryAnalysisStatus analysis={{ revision: 'abc', status: 'failed', errorCode: 'INTELLIGENCE_UNAVAILABLE' }} onRetry={retry} />)
    expect(screen.getByLabelText('Repository analysis status')).toHaveTextContent('deterministic evidence remains available')
    fireEvent.click(screen.getByRole('button', { name: 'Retry reviewed analysis' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('prevents duplicate retries while requeueing', () => {
    render(<RepositoryAnalysisStatus analysis={{ revision: 'abc', status: 'failed' }} onRetry={vi.fn()} retrying />)
    expect(screen.getByRole('button', { name: 'Requeueing…' })).toBeDisabled()
  })

  it('identifies a bounded FuzeInfra LiteLLM timeout and keeps retry available', () => {
    render(<RepositoryAnalysisStatus analysis={{ revision: 'abc', status: 'failed', startedAt: '2026-10-23T18:00:00.000Z', errorCode: 'INTELLIGENCE_TIMEOUT' }} onRetry={vi.fn()} />)
    expect(screen.getByLabelText('Repository analysis status')).toHaveTextContent('FuzeInfra LiteLLM timed out')
    expect(screen.getByRole('button', { name: 'Retry reviewed analysis' })).toBeEnabled()
  })

  it('distinguishes schema-invalid LiteLLM output without implying it was stored', () => {
    render(<RepositoryAnalysisStatus analysis={{ revision: 'abc', status: 'failed', startedAt: '2026-10-23T18:00:00.000Z', errorCode: 'INTELLIGENCE_INVALID_RESPONSE' }} onRetry={vi.fn()} />)
    expect(screen.getByLabelText('Repository analysis status')).toHaveTextContent('failed the reviewed schema')
    expect(screen.getByLabelText('Repository analysis status')).toHaveTextContent('no unreviewed proposal was stored')
    expect(screen.getByRole('button', { name: 'Retry reviewed analysis' })).toBeEnabled()
  })

  it('distinguishes setup exhaustion and keeps the reviewed-analysis retry actionable', () => {
    render(<RepositoryAnalysisStatus analysis={{
      revision: 'abc',
      status: 'failed',
      finishedAt: '2026-10-23T18:15:00.000Z',
      errorCode: 'INTELLIGENCE_UNAVAILABLE',
    }} onRetry={vi.fn()} />)
    expect(screen.getByLabelText('Repository analysis status')).toHaveTextContent(
      'could not start after bounded retries',
    )
    expect(screen.getByRole('button', { name: 'Retry reviewed analysis' })).toBeEnabled()
  })
})
