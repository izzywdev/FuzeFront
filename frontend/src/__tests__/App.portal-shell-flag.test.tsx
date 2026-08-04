/**
 * App.portal-shell-flag.test.tsx
 *
 * Feature-flag BOTH-STATES cover for fuzefront.platform.multi-tenant-portals
 * (FF-EPIC-13/FF-EPIC-10): an unauthenticated visitor to `/` or `/login` sees
 * the white-label PortalShell/PortalLoginFlow ONLY when the flag resolves on;
 * with the flag off, today's LoginPage renders completely unchanged — the
 * `feature-flags` skill's "test BOTH states" requirement for a release flag.
 *
 * @fuzeone/portal-branding-ui is mocked wholesale so this stays a fast,
 * isolated routing test — its own boot/branding behavior is covered by that
 * package's own component tests (PortalBrandingProvider/BrandingBoundary/
 * PortalShell/PortalLoginFlow .test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>('../lib/shared')
  return { ...actual, useCurrentUser: vi.fn() }
})

vi.mock('../services/api', () => ({
  getCurrentUser: vi.fn().mockRejectedValue(new Error('not authenticated')),
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

// Not exercised by the unauthenticated flows this file tests, but Layout.tsx
// statically imports @fuzeone/chat-client/chat-ui (and Layout now also
// pulls in @fuzeone/portal-branding-ui) — mocked here purely so Vite's
// eager ESM resolution of App.tsx's whole import graph doesn't need real
// workspace builds, mirroring App.authed-login-redirect.test.tsx.
vi.mock('../components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../pages/DashboardPage', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard</div>,
}))

vi.mock('../pages/LoginPage', () => ({
  default: () => <div data-testid="login-page">Login</div>,
}))

const isMultiTenantPortalsEnabled = vi.fn()
vi.mock('@fuzeone/portal-branding-ui', () => ({
  isMultiTenantPortalsEnabled: (...args: unknown[]) => isMultiTenantPortalsEnabled(...args),
  PortalShell: () => <div data-testid="portal-shell">PortalShell</div>,
  PortalLoginFlow: () => <div data-testid="portal-login-flow">PortalLoginFlow</div>,
}))

import App from '../App'
import * as sharedMock from '../lib/shared'
import { AppProvider } from '../lib/shared'

function setPath(path: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: path, href: `https://app.corpabc.com${path}` },
  })
}

describe('fuzefront.platform.multi-tenant-portals — both states', () => {
  beforeEach(() => {
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: null,
      currentUser: null,
      isAuthenticated: false,
      setUser: vi.fn(),
      setCurrentUser: vi.fn(),
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flag OFF: "/" renders today\'s LoginPage, unchanged', async () => {
    isMultiTenantPortalsEnabled.mockReturnValue(false)
    setPath('/')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
    expect(screen.queryByTestId('portal-shell')).toBeNull()
  })

  it('flag OFF: "/login" renders today\'s LoginPage, unchanged', async () => {
    isMultiTenantPortalsEnabled.mockReturnValue(false)
    setPath('/login')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
    expect(screen.queryByTestId('portal-login-flow')).toBeNull()
  })

  it('flag ON: "/" renders the white-label PortalShell', async () => {
    isMultiTenantPortalsEnabled.mockReturnValue(true)
    setPath('/')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('portal-shell')).toBeTruthy())
    expect(screen.queryByTestId('login-page')).toBeNull()
  })

  it('flag ON: "/login" renders the white-label PortalLoginFlow', async () => {
    isMultiTenantPortalsEnabled.mockReturnValue(true)
    setPath('/login')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('portal-login-flow')).toBeTruthy())
    expect(screen.queryByTestId('login-page')).toBeNull()
  })

  it('flag ON: an unrelated unauthenticated path ("/signup") still renders today\'s LoginPage', async () => {
    isMultiTenantPortalsEnabled.mockReturnValue(true)
    setPath('/signup')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/signup']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
  })
})
