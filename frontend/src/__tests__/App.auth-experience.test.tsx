/**
 * App.auth-experience.test.tsx (FFRNT-360)
 *
 * The public verify-email / password-reset routes live behind the pre-auth flag
 * `fuzefront.auth.experience` (default OFF). Both states are pinned here:
 *   - flag OFF: /signup/verify, /verify/email and /reset fall through to
 *     today's LoginPage, exactly as before;
 *   - flag ON: each renders its auth-experience page for an unauthenticated
 *     visitor (and /signup/verify + /verify/email for a signed-in one).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>('../lib/shared')
  return { ...actual, useCurrentUser: vi.fn() }
})

vi.mock('../services/api', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com', roles: [] }),
}))

vi.mock('../services/websocket', () => ({
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    onServer: vi.fn(),
    offServer: vi.fn(),
    emitServer: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

vi.mock('../platform/bridge', () => ({
  installBridge: vi.fn(),
  bridge: { setContext: vi.fn() },
}))

vi.mock('../platform/appRegistry', () => ({
  AppRegistryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../components/WorkspaceProvisioningGate', () => ({
  WorkspaceProvisioningGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../pages/DashboardPage', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard</div>,
}))

vi.mock('../pages/LoginPage', () => ({
  default: () => <div data-testid="login-page">Login</div>,
}))

vi.mock('../pages/AuthExperiencePages', () => ({
  VerifyCheckInboxPage: () => <div data-testid="verify-check-inbox">inbox</div>,
  VerifyLandingPage: () => <div data-testid="verify-landing">landing</div>,
  ResetPage: () => <div data-testid="reset-page">reset</div>,
}))

import App from '../App'
import * as sharedMock from '../lib/shared'
import { AppProvider } from '../lib/shared'

function setPath(path: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: path, search: '', href: `https://app.fuzefront.com${path}` },
  })
}

function mountAt(path: string) {
  setPath(path)
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>
  )
}

function setFlag(on: boolean | undefined) {
  const w = window as unknown as { __FF_AUTH_EXPERIENCE__?: boolean }
  if (on === undefined) delete w.__FF_AUTH_EXPERIENCE__
  else w.__FF_AUTH_EXPERIENCE__ = on
}

const SIGNED_OUT = {
  user: null,
  currentUser: null,
  isAuthenticated: false,
  setUser: vi.fn(),
  setCurrentUser: vi.fn(),
} as any

const SIGNED_IN = {
  user: { id: 'user-1', email: 'user@example.com', roles: [] },
  currentUser: { id: 'user-1', email: 'user@example.com', roles: [] },
  isAuthenticated: true,
  setUser: vi.fn(),
  setCurrentUser: vi.fn(),
} as any

describe('auth-experience routes (flag fuzefront.auth.experience)', () => {
  afterEach(() => {
    setFlag(undefined)
    vi.restoreAllMocks()
  })

  describe('flag OFF (default) — today\'s behaviour', () => {
    beforeEach(() => {
      vi.mocked(sharedMock.useCurrentUser).mockReturnValue(SIGNED_OUT)
    })

    it.each(['/reset', '/verify/email', '/signup/verify'])('%s falls through to LoginPage', async path => {
      mountAt(path)
      await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
      expect(screen.queryByTestId('reset-page')).toBeNull()
      expect(screen.queryByTestId('verify-landing')).toBeNull()
      expect(screen.queryByTestId('verify-check-inbox')).toBeNull()
    })

    it('stays OFF when the override is explicitly false', async () => {
      setFlag(false)
      mountAt('/reset')
      await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
    })
  })

  describe('flag ON', () => {
    beforeEach(() => {
      setFlag(true)
    })

    it('/reset renders the reset page for an unauthenticated visitor', async () => {
      vi.mocked(sharedMock.useCurrentUser).mockReturnValue(SIGNED_OUT)
      mountAt('/reset')
      await waitFor(() => expect(screen.getByTestId('reset-page')).toBeTruthy())
      expect(screen.queryByTestId('login-page')).toBeNull()
    })

    it('/verify/email renders the verify landing', async () => {
      vi.mocked(sharedMock.useCurrentUser).mockReturnValue(SIGNED_OUT)
      mountAt('/verify/email')
      await waitFor(() => expect(screen.getByTestId('verify-landing')).toBeTruthy())
    })

    it('/signup/verify renders check-inbox even for the freshly signed-up (authenticated) user', async () => {
      vi.mocked(sharedMock.useCurrentUser).mockReturnValue(SIGNED_IN)
      mountAt('/signup/verify')
      await waitFor(() => expect(screen.getByTestId('verify-check-inbox')).toBeTruthy())
      expect(screen.queryByTestId('dashboard-page')).toBeNull()
    })

    it('other unauthenticated paths still render LoginPage', async () => {
      vi.mocked(sharedMock.useCurrentUser).mockReturnValue(SIGNED_OUT)
      mountAt('/login')
      await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
    })
  })
})
