/**
 * App.selection-lists-shared-flag.test.tsx
 *
 * BOTH-STATES cover for the host mounting of `SharedListsFeatureProvider`
 * (SL9 shared lists; frames manifest `selection-lists-shared` -> `hostMounting`)
 * under release flag `fuzefront.selection-lists.shared-lists` (default OFF).
 *
 * The REAL provider from `@fuzeone/selection-lists-ui` is used (only the flows
 * and the auth wiring are stubbed), so this pins what a flow actually observes
 * through `useSharedLists()`: OFF unless the host passes boolean `true`, and the
 * platform-org hint only when ON. Covers every surface the manifest names: the
 * `/settings/selection-lists*` routes and the public
 * `/embed/selection-list-picker` harness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const orgState: { active: { id: string; type?: string } | null } = { active: null }

vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>('../lib/shared')
  return {
    ...actual,
    useCurrentUser: vi.fn(),
    useOrganizations: () => ({
      organizations: orgState.active ? [orgState.active] : [],
      activeOrganizationId: orgState.active?.id ?? null,
      activeOrganization: orgState.active,
      personalTenantId: null,
      setActiveOrganization: vi.fn(),
    }),
  }
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

// Real provider + hook + flag key; flows replaced by probes that print what
// they read from the provider.
vi.mock('@fuzeone/selection-lists-ui', async () => {
  const actual =
    await vi.importActual<typeof import('@fuzeone/selection-lists-ui')>('@fuzeone/selection-lists-ui')
  const Probe = ({ id }: { id: string }) => {
    const { enabled, isPlatformOrg } = actual.useSharedLists()
    return (
      <div
        data-testid={id}
        data-shared={String(enabled)}
        data-platform={String(isPlatformOrg)}
      />
    )
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

const SERVICE_FLAG = 'fuzefront.selection-lists.service'
const SHARED_FLAG = 'fuzefront.selection-lists.shared-lists'
const flags: Record<string, boolean> = {}
vi.mock('../platform/featureFlags', async () => {
  const actual = await vi.importActual<typeof import('../platform/featureFlags')>('../platform/featureFlags')
  return {
    ...actual,
    useFlag: (key: string, fallback: boolean) => (key in flags ? flags[key] : fallback),
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

const SURFACES: Array<[string, string]> = [
  ['/settings/selection-lists', 'sl-management'],
  ['/settings/selection-lists/sl_123', 'sl-management'],
  ['/settings/selection-lists/sl_123/translations', 'sl-translations'],
  ['/settings/selection-lists/sl_123/access', 'sl-access'],
  ['/embed/selection-list-picker', 'sl-picker'],
]

describe('fuzefront.selection-lists.shared-lists — host mounting both-states', () => {
  beforeEach(() => {
    for (const k of Object.keys(flags)) delete flags[k]
    // The surrounding service flag is ON: the routes render, so the only thing
    // varying across these cases is the shared-lists flag.
    flags[SERVICE_FLAG] = true
    orgState.active = null
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

  describe('flag OFF (default / absent): the surfaces still render, shared lists are OFF', () => {
    it.each(SURFACES)('%s sees shared-lists disabled when the flag is absent', async (path, testId) => {
      renderAt(path)
      const probe = await waitFor(() => screen.getByTestId(testId))
      expect(probe.getAttribute('data-shared')).toBe('false')
      expect(probe.getAttribute('data-platform')).toBe('false')
    })

    it.each(SURFACES)('%s sees shared-lists disabled when the flag is explicitly false', async (path, testId) => {
      flags[SHARED_FLAG] = false
      renderAt(path)
      const probe = await waitFor(() => screen.getByTestId(testId))
      expect(probe.getAttribute('data-shared')).toBe('false')
    })

    it('a platform org does not turn shared lists on while the flag is OFF', async () => {
      orgState.active = { id: 'org-platform', type: 'platform' }
      renderAt('/settings/selection-lists')
      const probe = await waitFor(() => screen.getByTestId('sl-management'))
      expect(probe.getAttribute('data-shared')).toBe('false')
      expect(probe.getAttribute('data-platform')).toBe('false')
    })
  })

  describe('flag ON: every surface sees shared-lists enabled', () => {
    beforeEach(() => {
      flags[SHARED_FLAG] = true
    })

    it.each(SURFACES)('%s sees shared-lists enabled', async (path, testId) => {
      renderAt(path)
      const probe = await waitFor(() => screen.getByTestId(testId))
      expect(probe.getAttribute('data-shared')).toBe('true')
      // No organization is active: the platform hint stays off.
      expect(probe.getAttribute('data-platform')).toBe('false')
    })

    it('passes the platform-org hint when the active organization type is platform', async () => {
      orgState.active = { id: 'org-platform', type: 'platform' }
      renderAt('/settings/selection-lists')
      const probe = await waitFor(() => screen.getByTestId('sl-management'))
      expect(probe.getAttribute('data-shared')).toBe('true')
      expect(probe.getAttribute('data-platform')).toBe('true')
    })

    it('does not pass the platform-org hint for an ordinary organization', async () => {
      orgState.active = { id: 'org-1', type: 'organization' }
      renderAt('/settings/selection-lists')
      const probe = await waitFor(() => screen.getByTestId('sl-management'))
      expect(probe.getAttribute('data-shared')).toBe('true')
      expect(probe.getAttribute('data-platform')).toBe('false')
    })
  })

  it('the shared-lists flag does not bypass the service flag: service OFF still redirects', async () => {
    flags[SERVICE_FLAG] = false
    flags[SHARED_FLAG] = true
    renderAt('/settings/selection-lists')
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
    expect(screen.queryByTestId('sl-management')).toBeNull()
  })
})
