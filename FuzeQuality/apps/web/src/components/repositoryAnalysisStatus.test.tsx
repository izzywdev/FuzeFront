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
})
