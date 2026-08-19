/**
 * App.employee-console-flag.test.tsx
 *
 * FF-EPIC-17-S9 — routing-layer cover for `/staff` + `/staff/orgs/:id`:
 * both routes stay registered in App.tsx regardless of
 * `fuzefront.identity.employee-console` (so linking never 404s mid-rollout),
 * and mount `EmployeeConsolePage`/`EmployeeOrgDrilldownPage` — which own the
 * flag gate, the `isEmployee` fail-closed gate, and the org/member data
 * fetching themselves (covered thoroughly in EmployeeConsolePage.test.tsx /
 * EmployeeOrgDrilldownPage.test.tsx). Mirrors
 * App.organizations-flag.test.tsx's mocking shape: the pages are stubbed so
 * this stays a fast, isolated routing test, not a full data-fetch
 * integration test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>('../lib/shared')
  return { ...actual, useCurrentUser: vi.fn() }
})

vi.mock('../services/api', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com', roles: ['employee'] }),
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

vi.mock('../pages/EmployeeConsolePage', () => ({
  default: () => <div data-testid="employee-console-page">staff console</div>,
}))

vi.mock('../pages/EmployeeOrgDrilldownPage', () => ({
  default: () => <div data-testid="employee-org-drilldown-page">staff org drilldown</div>,
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

function renderAt(path: string) {
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>
  )
}

describe('/staff routing — reachable regardless of fuzefront.identity.employee-console', () => {
  beforeEach(() => {
    flagValue = false
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', roles: ['employee'] },
      currentUser: { id: 'user-1', email: 'user@example.com', roles: ['employee'] },
      isAuthenticated: true,
      setUser: vi.fn(),
      setCurrentUser: vi.fn(),
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('"/staff" mounts EmployeeConsolePage regardless of flag (the page owns its own gate)', async () => {
    setPath('/staff')
    renderAt('/staff')
    await waitFor(() => expect(screen.getByTestId('employee-console-page')).toBeTruthy())
  })

  it('"/staff/orgs/:id" mounts EmployeeOrgDrilldownPage regardless of flag', async () => {
    setPath('/staff/orgs/org_acme')
    renderAt('/staff/orgs/org_acme')
    await waitFor(() => expect(screen.getByTestId('employee-org-drilldown-page')).toBeTruthy())
  })
})
