/**
 * App.organizations-flag.test.tsx
 *
 * FF-EPIC-17-S4 BOTH-STATES cover for fuzefront.identity.personal-context at
 * the routing layer: flag OFF renders today's `OrganizationPage` (local
 * `<select>` + tabs) at `/organizations`, completely unchanged; flag ON
 * renders the reconciled `MyOrganizationsPage` ("My orgs & sub-orgs") and
 * makes the net-new `/organizations/:id` route reachable
 * (`OrganizationDetailPage`) instead of redirecting back to `/organizations`.
 *
 * Mirrors App.authed-login-redirect.test.tsx / App.portal-shell-flag.test.tsx's
 * mocking shape so this stays a fast, isolated routing test.
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

vi.mock('../pages/OrganizationPage', () => ({
  default: () => <div data-testid="legacy-organization-page">legacy select + tabs</div>,
}))

vi.mock('../pages/MyOrganizationsPage', () => ({
  default: () => <div data-testid="my-organizations-page">My orgs &amp; sub-orgs</div>,
}))

vi.mock('../pages/OrganizationDetailPage', () => ({
  default: () => <div data-testid="organization-detail-page">org detail</div>,
}))

let flagValue = false
vi.mock('../platform/featureFlags', async () => {
  const actual = await vi.importActual<typeof import('../platform/featureFlags')>('../platform/featureFlags')
  return { ...actual, useFlag: (_key: string, _fallback: boolean) => flagValue }
})

import App from '../App'
import * as sharedMock from '../lib/shared'
import { AppProvider } from '../lib/shared'

function setPath(path: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: path, href: `https://app.fuzefront.com${path}` },
  })
}

describe('fuzefront.identity.personal-context — /organizations both states', () => {
  beforeEach(() => {
    flagValue = false
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

  it('flag OFF: "/organizations" renders today\'s OrganizationPage unchanged', async () => {
    flagValue = false
    setPath('/organizations')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/organizations']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('legacy-organization-page')).toBeTruthy())
    expect(screen.queryByTestId('my-organizations-page')).toBeNull()
  })

  it('flag ON: "/organizations" renders the reconciled MyOrganizationsPage', async () => {
    flagValue = true
    setPath('/organizations')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/organizations']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('my-organizations-page')).toBeTruthy())
    expect(screen.queryByTestId('legacy-organization-page')).toBeNull()
  })

  it('flag OFF: "/organizations/:id" redirects back to /organizations (no legacy behavior to preserve)', async () => {
    flagValue = false
    setPath('/organizations/org-1')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/organizations/org-1']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('legacy-organization-page')).toBeTruthy())
    expect(screen.queryByTestId('organization-detail-page')).toBeNull()
  })

  it('flag ON: "/organizations/:id" renders OrganizationDetailPage', async () => {
    flagValue = true
    setPath('/organizations/org-1')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/organizations/org-1']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('organization-detail-page')).toBeTruthy())
  })
})
