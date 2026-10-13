/**
 * App.selection-lists-flag-ready.test.tsx
 *
 * Deep-link regression for release flag `fuzefront.selection-lists.service`.
 * `useFlag()` returns OFF until `/api/flags` settles, so the gated routes used
 * to redirect a hard load / refresh / bookmark of /settings/selection-lists*
 * to /dashboard even when the flag was ON. The routes now use the opt-in
 * `useFlagState()` and must WAIT for the fetch to settle.
 *
 * Unlike App.selection-lists-flag.test.tsx (which pins a settled flag value),
 * this drives the REAL FeatureFlagProvider against a stubbed `/api/flags`
 * fetch, covering: loading (no redirect), settled-ON, settled-OFF, and
 * fetch-error (fail-closed redirect).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>('../lib/shared')
  return { ...actual, useCurrentUser: vi.fn() }
})

vi.mock('../lib/accounts', async () => {
  const actual = await vi.importActual<typeof import('../lib/accounts')>('../lib/accounts')
  return { ...actual, getActiveAuthToken: () => 'test-token' }
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
  configureSelectionListsAuth: vi.fn(),
}))

import App from '../App'
import * as sharedMock from '../lib/shared'
import { AppProvider } from '../lib/shared'

const FLAG = 'fuzefront.selection-lists.service'

type FlagsResponse = { ok: boolean; json: () => Promise<unknown> }
let resolveFlags: (r: FlagsResponse) => void
let rejectFlags: (e: Error) => void

function stubFlagsFetch() {
  const pending = new Promise<FlagsResponse>((resolve, reject) => {
    resolveFlags = resolve
    rejectFlags = reject
  })
  // The deferred is owned by the test, and the production code under test handles
  // its rejection (fetchFlags catches and fails closed). Without this guard a test
  // that rejects it can race the component's own handler (unmount/abort between the
  // reject and the await) and Node reports an UNHANDLED rejection, which Vitest turns
  // into a failed run even though every test passed (~1 run in 8 locally).
  pending.catch(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url === '/api/flags' ? pending : Promise.resolve({ ok: false, json: async () => ({}) }),
    ),
  )
}

function flagsBody(value: boolean): FlagsResponse {
  return { ok: true, json: async () => ({ flags: { [FLAG]: value } }) }
}

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
    </AppProvider>,
  )
}

const ROUTES: Array<[string, string]> = [
  ['/settings/selection-lists', 'sl-management'],
  ['/settings/selection-lists/sl_123', 'sl-management'],
  ['/settings/selection-lists/sl_123/translations', 'sl-translations'],
  ['/settings/selection-lists/sl_123/translations/fr', 'sl-translations'],
  ['/settings/selection-lists/sl_123/access', 'sl-access'],
]

describe('fuzefront.selection-lists.service — deep links wait for flag state', () => {
  beforeEach(() => {
    stubFlagsFetch()
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', roles: [] },
      currentUser: { id: 'user-1', email: 'user@example.com', roles: [] },
      isAuthenticated: true,
      setUser: vi.fn(),
      setCurrentUser: vi.fn(),
    } as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('loading: /api/flags not yet settled', () => {
    it.each(ROUTES)('%s shows a placeholder — no redirect, no flow', async (path, testId) => {
      renderAt(path)
      await waitFor(() => expect(screen.getByTestId('selection-lists-flag-loading')).toBeTruthy())
      expect(screen.queryByTestId('dashboard-page')).toBeNull()
      expect(screen.queryByTestId(testId)).toBeNull()
    })
  })

  describe('settled ON: the deep link renders its flow', () => {
    it.each(ROUTES)('%s renders its flow after the fetch resolves', async (path, testId) => {
      renderAt(path)
      await waitFor(() => expect(screen.getByTestId('selection-lists-flag-loading')).toBeTruthy())
      await act(async () => resolveFlags(flagsBody(true)))
      await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy())
      expect(screen.queryByTestId('dashboard-page')).toBeNull()
      expect(screen.queryByTestId('selection-lists-flag-loading')).toBeNull()
    })
  })

  describe('settled OFF: redirect to /dashboard', () => {
    it.each(ROUTES)('%s redirects once the fetch settles OFF', async (path, testId) => {
      renderAt(path)
      await waitFor(() => expect(screen.getByTestId('selection-lists-flag-loading')).toBeTruthy())
      await act(async () => resolveFlags(flagsBody(false)))
      await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
      expect(screen.queryByTestId(testId)).toBeNull()
    })
  })

  describe('fetch error: fail-closed (redirect)', () => {
    it.each(ROUTES)('%s redirects when the flags fetch rejects', async (path, testId) => {
      renderAt(path)
      await waitFor(() => expect(screen.getByTestId('selection-lists-flag-loading')).toBeTruthy())
      await act(async () => rejectFlags(new Error('network down')))
      await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
      expect(screen.queryByTestId(testId)).toBeNull()
    })

    it('redirects when the flags endpoint returns non-200', async () => {
      renderAt('/settings/selection-lists')
      await waitFor(() => expect(screen.getByTestId('selection-lists-flag-loading')).toBeTruthy())
      await act(async () => resolveFlags({ ok: false, json: async () => ({}) }))
      await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
      expect(screen.queryByTestId('sl-management')).toBeNull()
    })
  })
})
