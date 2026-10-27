/**
 * App.selection-lists-shared-ready.test.tsx
 *
 * `SharedListsHost` must tell the package when the shared-lists flag has NOT
 * settled (`ready={false}` until `/api/flags` does), so the picker on the public
 * `/embed/selection-list-picker` route (and any other consumer that issues
 * requests) waits instead of running the 4.0.0 path first and the shared path
 * again when the flag flips ON. Drives the REAL FeatureFlagProvider against a
 * stubbed `/api/flags`. An unauthenticated embed has no token: the fetch is never
 * made, the flag settles OFF and the picker renders (it must not hang).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>('../lib/shared')
  return { ...actual, useCurrentUser: vi.fn() }
})

const session: { token: string | null } = { token: 'test-token' }
vi.mock('../lib/accounts', async () => {
  const actual = await vi.importActual<typeof import('../lib/accounts')>('../lib/accounts')
  return { ...actual, getActiveAuthToken: () => session.token }
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

vi.mock('@fuzeone/selection-lists-ui', async () => {
  const actual =
    await vi.importActual<typeof import('@fuzeone/selection-lists-ui')>('@fuzeone/selection-lists-ui')
  const Probe = ({ id }: { id: string }) => {
    const { enabled, ready } = actual.useSharedLists()
    return <div data-testid={id} data-shared={String(enabled)} data-ready={String(ready)} />
  }
  return {
    SharedListsFeatureProvider: actual.SharedListsFeatureProvider,
    SHARED_LISTS_FLAG_KEY: actual.SHARED_LISTS_FLAG_KEY,
    SelectionListManagementFlow: () => <Probe id="sl-management" />,
    TranslationWorkbenchFlow: () => <Probe id="sl-translations" />,
    SelectionListAccessFlow: () => <Probe id="sl-access" />,
    SelectionListPickerHarness: () => <Probe id="sl-picker" />,
    configureSelectionListsAuth: vi.fn(),
  }
})

import App from '../App'
import * as sharedMock from '../lib/shared'
import { AppProvider } from '../lib/shared'

const SERVICE_FLAG = 'fuzefront.selection-lists.service'
const SHARED_FLAG = 'fuzefront.selection-lists.shared-lists'

type FlagsResponse = { ok: boolean; json: () => Promise<unknown> }
let resolveFlags: (r: FlagsResponse) => void
let flagsFetch: ReturnType<typeof vi.fn>

function stubFlagsFetch() {
  const pending = new Promise<FlagsResponse>(resolve => {
    resolveFlags = resolve
  })
  flagsFetch = vi.fn((url: string) =>
    url === '/api/flags' ? pending : Promise.resolve({ ok: false, json: async () => ({}) }),
  )
  vi.stubGlobal('fetch', flagsFetch)
}

const flagsBody = (shared: boolean): FlagsResponse => ({
  ok: true,
  json: async () => ({ flags: { [SERVICE_FLAG]: true, [SHARED_FLAG]: shared } }),
})

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

const EMBED = '/embed/selection-list-picker'

describe('SharedListsHost — tells the package when the shared-lists flag has not settled', () => {
  beforeEach(() => {
    session.token = 'test-token'
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

  it('the embedded picker mounts at once but sees NOT READY (and OFF) until /api/flags settles', async () => {
    renderAt(EMBED)
    const probe = await waitFor(() => screen.getByTestId('sl-picker'))
    expect(probe.getAttribute('data-ready')).toBe('false')
    expect(probe.getAttribute('data-shared')).toBe('false')
  })

  it('settles ON: ready, and the shared path is selected — no OFF-first frame in between', async () => {
    renderAt(EMBED)
    await waitFor(() => expect(screen.getByTestId('sl-picker').getAttribute('data-ready')).toBe('false'))
    await act(async () => resolveFlags(flagsBody(true)))
    await waitFor(() => expect(screen.getByTestId('sl-picker').getAttribute('data-ready')).toBe('true'))
    expect(screen.getByTestId('sl-picker').getAttribute('data-shared')).toBe('true')
  })

  it('settles OFF: ready and OFF', async () => {
    renderAt(EMBED)
    await act(async () => resolveFlags(flagsBody(false)))
    await waitFor(() => expect(screen.getByTestId('sl-picker').getAttribute('data-ready')).toBe('true'))
    expect(screen.getByTestId('sl-picker').getAttribute('data-shared')).toBe('false')
  })

  it('an unauthenticated embed (no session token) settles OFF at once — it never waits on a fetch that is not made', async () => {
    session.token = null
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: null,
      currentUser: null,
      isAuthenticated: false,
      setUser: vi.fn(),
      setCurrentUser: vi.fn(),
    } as any)
    renderAt(EMBED)
    await waitFor(() => expect(screen.getByTestId('sl-picker').getAttribute('data-ready')).toBe('true'))
    expect(screen.getByTestId('sl-picker').getAttribute('data-shared')).toBe('false')
    expect(flagsFetch).not.toHaveBeenCalledWith('/api/flags', expect.anything())
  })
})
