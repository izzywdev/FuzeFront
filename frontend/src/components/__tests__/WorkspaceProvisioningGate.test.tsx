import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceProvisioningGate } from '../WorkspaceProvisioningGate'
import { AppProvider } from '../../lib/shared'
import { LanguageProvider } from '../../contexts/LanguageContext'
import * as api from '../../services/api'

// ── helpers ──────────────────────────────────────────────────────────────────

const personalOrg = { id: 'org-1', name: 'My Workspace', type: 'personal' }
const teamOrg = { id: 'org-2', name: 'ACME Corp', type: 'team' }

/** Flush all pending microtasks (resolved Promise callbacks) */
const flushMicrotasks = () => act(async () => { await Promise.resolve() })

function renderGate(children: React.ReactNode = <div>App content</div>) {
  return render(
    <LanguageProvider>
      <AppProvider>
        <WorkspaceProvisioningGate>{children}</WorkspaceProvisioningGate>
      </AppProvider>
    </LanguageProvider>
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('WorkspaceProvisioningGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders children immediately when a personal org is present', async () => {
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([
      personalOrg,
    ])

    renderGate()

    await waitFor(() => {
      expect(screen.getByText('App content')).toBeInTheDocument()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the provisioning spinner when no personal org exists yet', async () => {
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([
      teamOrg,
    ])

    renderGate()

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    }, { timeout: 3000 })
    expect(screen.getByText('Creating your workspace…')).toBeInTheDocument()
    expect(screen.queryByText('App content')).not.toBeInTheDocument()
  })

  it('unblocks when the personal org arrives on a subsequent poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let callCount = 0
    const getOrgs = vi
      .spyOn(api.organizationsAPI, 'getOrganizations')
      .mockImplementation(async () => {
        callCount++
        if (callCount <= 2) return [teamOrg]
        return [personalOrg]
      })

    renderGate()

    // Flush the initial async check
    await flushMicrotasks()

    // Spinner should be visible
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Advance past 2 poll intervals (1 750 ms each) and flush promises each time
    await act(async () => {
      vi.advanceTimersByTime(1750)
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(1750)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('App content')).toBeInTheDocument()
    })
    expect(getOrgs).toHaveBeenCalledTimes(3)
  })

  it('transitions to timeout state after 30 s without a personal org', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([
      teamOrg,
    ])

    renderGate()

    // Flush the initial async check
    await flushMicrotasks()

    // Spinner visible
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Advance past the 30 s timeout
    await act(async () => {
      vi.advanceTimersByTime(31_000)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(
        screen.getByText('Taking longer than expected')
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText('App content')).not.toBeInTheDocument()
  })

  it('transitions to error state on a network failure', async () => {
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockRejectedValue(
      new Error('Network error')
    )

    renderGate()

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    }, { timeout: 5000 })
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('restarts polling when the retry button is clicked', async () => {
    const getOrgs = vi
      .spyOn(api.organizationsAPI, 'getOrganizations')
      .mockRejectedValueOnce(new Error('Network error')) // initial → error
      .mockResolvedValue([personalOrg])                  // after retry → success

    renderGate()

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click retry
    const retryBtn = screen.getByRole('button', { name: /try again/i })
    await act(async () => {
      await userEvent.click(retryBtn)
    })

    await waitFor(() => {
      expect(screen.getByText('App content')).toBeInTheDocument()
    }, { timeout: 5000 })
    expect(getOrgs).toHaveBeenCalledTimes(2)
  })

  it('does not call the API after unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const getOrgs = vi
      .spyOn(api.organizationsAPI, 'getOrganizations')
      .mockResolvedValue([teamOrg])

    const { unmount } = renderGate()

    // Flush the initial async check
    await flushMicrotasks()

    // Wait for polling to start (spinner visible)
    expect(screen.getByRole('status')).toBeInTheDocument()

    const callCountAfterMount = getOrgs.mock.calls.length

    unmount()

    // Advance timer — the interval should have been cleared on unmount
    await act(async () => {
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
    })

    expect(getOrgs.mock.calls.length).toBe(callCountAfterMount)
  })
})

