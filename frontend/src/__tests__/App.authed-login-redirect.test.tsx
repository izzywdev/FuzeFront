/**
 * App.authed-login-redirect.test.tsx
 *
 * Regression cover for the prod BUG 1: an authenticated user who navigated
 * (or was linked) to /login or /signup saw the app shell's catch-all
 * "404 - Page Not Found" page instead of being routed to /dashboard. The
 * authenticated route tree in App.tsx (AppContent) never registered /login
 * or /signup at all, so both fell through to the `*` NotFoundPage route.
 *
 * Fixed by short-circuiting both paths to `<Navigate to="/dashboard" replace />`
 * before the standalone/portal route tree is evaluated, for any authenticated
 * session (password or social login alike).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>(
    '../lib/shared'
  )
  return {
    ...actual,
    useCurrentUser: vi.fn(),
  }
})

vi.mock('../services/api', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: 'user-1',
    email: 'user@example.com',
    roles: [],
  }),
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
  AppRegistryProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('../components/WorkspaceProvisioningGate', () => ({
  WorkspaceProvisioningGate: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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

import App from '../App'
import * as sharedMock from '../lib/shared'

/** Point window.location.pathname at `path` without navigating jsdom. */
function setPath(path: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: path, href: `https://app.fuzefront.com${path}` },
  })
}

describe('BUG 1 — authenticated /login and /signup redirect to /dashboard', () => {
  beforeEach(() => {
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', roles: [] },
      currentUser: { id: 'user-1', email: 'user@example.com', roles: [] },
      isAuthenticated: true,
      setUser: vi.fn(),
      setCurrentUser: vi.fn(),
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redirects an authenticated user from /login to /dashboard', async () => {
    setPath('/login')
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-page')).toBeTruthy()
    )
    expect(screen.queryByText(/404 - Page Not Found/i)).toBeNull()
  })

  it('redirects an authenticated user from /signup to /dashboard', async () => {
    setPath('/signup')
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-page')).toBeTruthy()
    )
    expect(screen.queryByText(/404 - Page Not Found/i)).toBeNull()
  })

  it('still renders /dashboard directly (no regression on the normal path)', async () => {
    setPath('/dashboard')
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-page')).toBeTruthy()
    )
  })
})
