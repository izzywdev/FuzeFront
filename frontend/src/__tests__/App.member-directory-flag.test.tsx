/**
 * App.member-directory-flag.test.tsx
 *
 * FF-EPIC-17-S5 BOTH-STATES cover for fuzefront.identity.member-directory at
 * the routing layer: flag OFF redirects `/organizations/:id/directory` back
 * to `/organizations/:id` (net-new route, zero regression to preserve);
 * flag ON renders `MemberDirectoryPage`. Independent of
 * `fuzefront.identity.personal-context` — the directory route is a sibling
 * of `/organizations/:id`, not nested under it.
 *
 * Mirrors App.organizations-flag.test.tsx's mocking shape.
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

vi.mock('../pages/OrganizationDetailPage', () => ({
  default: () => <div data-testid="organization-detail-page">org detail</div>,
}))

vi.mock('../pages/MemberDirectoryPage', () => ({
  default: () => <div data-testid="member-directory-page">member directory</div>,
}))

let memberDirectoryFlag = false
vi.mock('../platform/featureFlags', async () => {
  const actual = await vi.importActual<typeof import('../platform/featureFlags')>('../platform/featureFlags')
  return {
    ...actual,
    useFlag: (key: string, fallback: boolean) =>
      key === 'fuzefront.identity.member-directory' ? memberDirectoryFlag : fallback,
  }
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

describe('fuzefront.identity.member-directory — /organizations/:id/directory both states', () => {
  beforeEach(() => {
    memberDirectoryFlag = false
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

  it('flag OFF (default): redirects to /organizations/:id — zero regression, nothing linked this route before', async () => {
    memberDirectoryFlag = false
    setPath('/organizations/org-1/directory')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/organizations/org-1/directory']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    // personal-context is also OFF by default here, so the redirect target
    // (/organizations/org-1) itself falls back to the legacy OrganizationPage.
    await waitFor(() => expect(screen.getByTestId('legacy-organization-page')).toBeTruthy())
    expect(screen.queryByTestId('member-directory-page')).toBeNull()
  })

  it('flag ON: renders MemberDirectoryPage at /organizations/:id/directory', async () => {
    memberDirectoryFlag = true
    setPath('/organizations/org-1/directory')
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/organizations/org-1/directory']}>
          <App />
        </MemoryRouter>
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByTestId('member-directory-page')).toBeTruthy())
    expect(screen.queryByTestId('legacy-organization-page')).toBeNull()
  })
})
