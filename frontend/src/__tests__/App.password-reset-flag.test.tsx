/**
 * App.password-reset-flag.test.tsx
 *
 * Feature-flag BOTH-STATES cover for fuzefront.account-security.password-reset
 * (FFRNT-140) on the PRE-AUTH `/reset` route: an unauthenticated visitor sees
 * the password-reset flow ONLY when the flag resolves ON through the pre-auth
 * override (window.__FF_FLAGS__ — platform/preAuthFlags.ts); with the flag OFF
 * (default) today's LoginPage renders completely unchanged.
 *
 * The reset page and the portal-branding package are mocked so this stays a fast
 * routing test; the flow itself is covered in packages/account-security-ui.
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

vi.mock('../components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../pages/DashboardPage', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard</div>,
}))

vi.mock('../pages/LoginPage', () => ({
  default: () => <div data-testid="login-page">Login</div>,
}))

vi.mock('../pages/ResetPasswordPage', () => ({
  default: () => <div data-testid="reset-page">Reset</div>,
}))

vi.mock('@fuzefront/portal-branding-ui', () => ({
  isMultiTenantPortalsEnabled: () => false,
  PortalShell: () => null,
  PortalLoginFlow: () => null,
}))

import App from '../App'
import * as sharedMock from '../lib/shared'
import { AppProvider } from '../lib/shared'

const FLAG = 'fuzefront.account-security.password-reset'

function setPath(path: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: path, href: `https://app.corpabc.com${path}` },
  })
}

function setFlag(v: boolean | undefined) {
  ;(window as unknown as { __FF_FLAGS__?: Record<string, boolean> }).__FF_FLAGS__ =
    v === undefined ? undefined : { [FLAG]: v }
}

function renderAt(path: string) {
  setPath(path)
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>
  )
}

describe('fuzefront.account-security.password-reset — /reset both states', () => {
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
    setFlag(undefined)
    vi.restoreAllMocks()
  })

  it("flag unset (default OFF): /reset renders today's LoginPage, unchanged", async () => {
    setFlag(undefined)
    renderAt('/reset')
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
    expect(screen.queryByTestId('reset-page')).toBeNull()
  })

  it('flag OFF: /reset/confirm renders LoginPage, unchanged', async () => {
    setFlag(false)
    renderAt('/reset/confirm')
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
    expect(screen.queryByTestId('reset-page')).toBeNull()
  })

  it('flag ON: /reset renders the password-reset page', async () => {
    setFlag(true)
    renderAt('/reset')
    await waitFor(() => expect(screen.getByTestId('reset-page')).toBeTruthy())
    expect(screen.queryByTestId('login-page')).toBeNull()
  })

  it('flag ON: /reset/confirm (emailed link) also renders it', async () => {
    setFlag(true)
    renderAt('/reset/confirm')
    await waitFor(() => expect(screen.getByTestId('reset-page')).toBeTruthy())
  })

  it('flag ON does not hijack other unauthenticated paths', async () => {
    setFlag(true)
    renderAt('/login')
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeTruthy())
    expect(screen.queryByTestId('reset-page')).toBeNull()
  })
})
