import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AcceptInvitePage from '../pages/AcceptInvitePage'
import { AppProvider } from '../lib/shared'
import { LanguageProvider } from '../contexts/LanguageContext'
import * as api from '../services/api'
import * as shared from '../lib/shared'

// Silence console errors in tests
vi.spyOn(console, 'error').mockImplementation(() => {})

function renderPage(token = 'test-token-abc123') {
  return render(
    <MemoryRouter initialEntries={[`/invitations/${token}`]}>
      <LanguageProvider>
        <AppProvider>
          <Routes>
            <Route path="/invitations/:token" element={<AcceptInvitePage />} />
          </Routes>
        </AppProvider>
      </LanguageProvider>
    </MemoryRouter>
  )
}

const mockInvitationResponse = {
  invitation: {
    id: 'inv-1',
    email: 'user@example.com',
    role: 'member',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
  },
  organization: {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
  },
}

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('shows loading state initially', () => {
    vi.spyOn(api, 'getInvitation').mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()
    expect(screen.getByText(/loading invitation/i)).toBeInTheDocument()
  })

  it('shows org name and role after loading valid invitation', async () => {
    vi.spyOn(api, 'getInvitation').mockResolvedValue(mockInvitationResponse)
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/acme corp/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/member/i)).toBeInTheDocument()
    expect(screen.getByText(/user@example\.com/i)).toBeInTheDocument()
  })

  it('shows expired state for 410 response', async () => {
    vi.spyOn(api, 'getInvitation').mockRejectedValue({
      response: { status: 410 },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/invitation expired/i)).toBeInTheDocument()
    })
  })

  it('shows not found error for 404 response', async () => {
    vi.spyOn(api, 'getInvitation').mockRejectedValue({
      response: { status: 404 },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/invitation not found/i)).toBeInTheDocument()
    })
  })

  it('shows sign in button when not authenticated', async () => {
    vi.spyOn(api, 'getInvitation').mockResolvedValue(mockInvitationResponse)
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/sign in to accept/i)).toBeInTheDocument()
    })
  })

  it('shows email mismatch message when logged in as wrong user', async () => {
    vi.spyOn(api, 'getInvitation').mockResolvedValue(mockInvitationResponse)
    // Mock useCurrentUser to return a different email than the invitation target.
    vi.spyOn(shared, 'useCurrentUser').mockReturnValue({
      isAuthenticated: true,
      user: { id: 'user-2', email: 'wrong@example.com' } as any,
      currentUser: { id: 'user-2', email: 'wrong@example.com' } as any,
      setCurrentUser: vi.fn(),
      setUser: vi.fn(),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/acme corp/i)).toBeInTheDocument()
    })

    // Should show a message about being signed in as the wrong account.
    // "wrong@example.com" appears once (in the mismatch message).
    expect(screen.getByText(/wrong@example\.com/i)).toBeInTheDocument()
    // "user@example.com" appears at least twice: "Invited to:" line + mismatch message.
    const emailMatches = screen.getAllByText(/user@example\.com/i)
    expect(emailMatches.length).toBeGreaterThanOrEqual(2)
    // The "sign in with the correct account" guidance should be shown.
    expect(screen.getByText(/sign in with the correct account/i)).toBeInTheDocument()
    // The "Accept invitation" button should NOT be shown.
    expect(screen.queryByText(/accept invitation/i)).not.toBeInTheDocument()
  })
})

