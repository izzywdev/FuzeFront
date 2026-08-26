import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceProvisioningGate } from '../WorkspaceProvisioningGate'
import { AppProvider, useAppContext } from '../../lib/shared'
import * as shared from '../../lib/shared'
import { LanguageProvider } from '../../contexts/LanguageContext'
import * as api from '../../services/api'

// ── fixtures ─────────────────────────────────────────────────────────────────
//
// `GET /organizations` returns every org the caller is an active member of,
// PLUS any `type: 'platform'` org — the latter is visible to every
// authenticated user regardless of membership (see
// `backend/security/src/routes/organizations.ts`'s
// `whereNotNull(organization_memberships.id) OR organizations.type =
// 'platform'` join condition). The security-service route also projects the
// caller's own role as `user_role`, `null` when they merely see the
// platform org without belonging to it. These fixtures mirror that wire
// shape exactly — they are not a shortcut around it.

/** A genuine personal-org membership — the historical happy path. */
const personalOrg = {
  id: 'org-1',
  name: 'My Workspace',
  type: 'personal',
  user_role: 'owner',
}

/**
 * A real membership whose `type` column was wrongly reclassified away from
 * `'personal'` (the production defect PR #788 repairs at the source) — the
 * membership itself was never touched. A provisioned user in this state
 * must still reach the shell.
 */
const reclassifiedOrg = {
  id: 'org-1',
  name: 'My Workspace',
  type: 'organization',
  user_role: 'owner',
}

/**
 * The always-visible platform org. Present for every authenticated caller
 * whether or not their own workspace has been provisioned — `user_role` is
 * `null` because the caller holds no membership row in it. On its own this
 * must NOT be read as "provisioned" (that would make the gate
 * unconditionally ready and defeat its purpose).
 */
const platformOrg = {
  id: 'org-platform',
  name: 'FuzeFront',
  type: 'platform',
  user_role: null,
}

/** Flush all pending microtasks (resolved Promise callbacks) */
const flushMicrotasks = () => act(async () => { await Promise.resolve() })

/** Renders the active organization id next to the gated children, so tests
 * can assert WHICH org the gate picked as active — not just that some org
 * unblocked it. */
function ActiveOrgProbe() {
  const { state } = useAppContext()
  return <div data-testid="active-org">{state.activeOrganizationId ?? ''}</div>
}

function renderGate(
  children: React.ReactNode = (
    <>
      <div>App content</div>
      <ActiveOrgProbe />
    </>
  )
) {
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
    sessionStorage.clear()
    localStorage.clear()
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
    expect(screen.getByTestId('active-org')).toHaveTextContent('org-1')
  })

  it('reaches the shell for a user whose organizations exist but none is type=personal', async () => {
    // This is the production defect: a real membership survives with its
    // `type` column reclassified away from 'personal'. The gate must not
    // key readiness off `type === 'personal'` any more.
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([
      reclassifiedOrg,
    ])

    renderGate()

    await waitFor(() => {
      expect(screen.getByText('App content')).toBeInTheDocument()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // The reclassified-but-real membership org is still selected active.
    expect(screen.getByTestId('active-org')).toHaveTextContent('org-1')
  })

  it('shows the provisioning spinner for a genuinely unprovisioned user (only the visible platform org, no membership)', async () => {
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([
      platformOrg,
    ])

    renderGate()

    // Both the initial `checking` state and the `provisioning` state render the
    // loading spinner (role="status"), so wait for the provisioning-specific copy
    // to confirm the gate has transitioned past the initial check — not merely
    // that a spinner is on screen.
    await waitFor(() => {
      expect(screen.getByText('Creating your workspace…')).toBeInTheDocument()
    }, { timeout: 3000 })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('App content')).not.toBeInTheDocument()
  })

  it('shows the provisioning spinner for a genuinely unprovisioned user (empty org list)', async () => {
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([])

    renderGate()

    await waitFor(() => {
      expect(screen.getByText('Creating your workspace…')).toBeInTheDocument()
    }, { timeout: 3000 })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('App content')).not.toBeInTheDocument()
  })

  it('unblocks when a real membership arrives on a subsequent poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let callCount = 0
    const getOrgs = vi
      .spyOn(api.organizationsAPI, 'getOrganizations')
      .mockImplementation(async () => {
        callCount++
        if (callCount <= 2) return [platformOrg]
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

  it('transitions to timeout state after 30 s when provisioning never completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([
      platformOrg,
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
      .mockResolvedValue([platformOrg])

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

  it('prefers a persisted active org over the personal org, among real memberships', async () => {
    const otherMemberOrg = {
      id: 'org-2',
      name: 'ACME Corp',
      type: 'organization',
      user_role: 'member',
    }
    vi.spyOn(shared, 'getPersistedActiveOrganizationId').mockReturnValue(
      'org-2'
    )
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([
      personalOrg,
      otherMemberOrg,
    ])

    renderGate()

    await waitFor(() => {
      expect(screen.getByText('App content')).toBeInTheDocument()
    })
    expect(screen.getByTestId('active-org')).toHaveTextContent('org-2')
  })

  it('falls back to any real membership when none is persisted or personal', async () => {
    const otherMemberOrg = {
      id: 'org-2',
      name: 'ACME Corp',
      type: 'organization',
      user_role: 'member',
    }
    vi.spyOn(api.organizationsAPI, 'getOrganizations').mockResolvedValue([
      platformOrg,
      otherMemberOrg,
    ])

    renderGate()

    await waitFor(() => {
      expect(screen.getByText('App content')).toBeInTheDocument()
    })
    // Never the platform org — only a real membership is eligible as active.
    expect(screen.getByTestId('active-org')).toHaveTextContent('org-2')
  })
})
