/**
 * App.selection-lists-flag.test.tsx
 *
 * BOTH-STATES cover for release flag `fuzefront.selection-lists.service`
 * (default OFF) at the routing layer. Every selection-list route is net-new,
 * so flag OFF must redirect to /dashboard (never render the flow, never
 * dead-end a stale link); flag ON must render the matching flow.
 *
 * Mirrors App.config-console-flags.test.tsx's mocking shape. The
 * `@fuzeone/selection-lists-ui` flows are stubbed so this asserts ONLY the
 * host's gating, independent of the package's own build/tests.
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
  default: () => <div data-testid="dashboard-page">dashboard</div>,
}))

vi.mock('@fuzeone/selection-lists-ui', () => ({
  SelectionListManagementFlow: () => <div data-testid="sl-management">management</div>,
  TranslationWorkbenchFlow: () => <div data-testid="sl-translations">translations</div>,
  SelectionListAccessFlow: () => <div data-testid="sl-access">access</div>,
  SelectionListPickerHarness: () => <div data-testid="sl-picker">picker</div>,
}))

const FLAG = 'fuzefront.selection-lists.service'
const flags: Record<string, boolean> = { [FLAG]: false }
vi.mock('../platform/featureFlags', async () => {
  const actual = await vi.importActual<typeof import('../platform/featureFlags')>('../platform/featureFlags')
  return {
    ...actual,
    useFlag: (key: string, fallback: boolean) => (key in flags ? flags[key] : fallback),
    // Route guards use the opt-in {enabled, ready} hook; this file pins the
    // settled state (loading / fetch-error are covered in
    // App.selection-lists-flag-ready.test.tsx against the real provider).
    useFlagState: (key: string, fallback: boolean) => ({
      enabled: key in flags ? flags[key] : fallback,
      ready: true,
    }),
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

const ROUTES: Array<[string, string]> = [
  ['/settings/selection-lists', 'sl-management'],
  ['/settings/selection-lists/sl_123', 'sl-management'],
  ['/settings/selection-lists/sl_123/translations', 'sl-translations'],
  ['/settings/selection-lists/sl_123/translations/fr', 'sl-translations'],
  ['/settings/selection-lists/sl_123/access', 'sl-access'],
]

describe('fuzefront.selection-lists.service — routing both-states', () => {
  beforeEach(() => {
    flags[FLAG] = false
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

  describe('flag OFF (default): every selection-list route redirects to /dashboard', () => {
    it.each(ROUTES)('%s never renders its flow', async (path, testId) => {
      renderAt(path)
      await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
      expect(screen.queryByTestId(testId)).toBeNull()
    })
  })

  describe('flag ON: every selection-list route renders its flow', () => {
    it.each(ROUTES)('%s renders its flow', async (path, testId) => {
      flags[FLAG] = true
      renderAt(path)
      await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy())
      expect(screen.queryByTestId('dashboard-page')).toBeNull()
    })
  })
})
