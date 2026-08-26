/**
 * App.config-console-flags.test.tsx
 *
 * FF-EPIC-19-S3/S4 BOTH-STATES cover for the three Configuration Management
 * Console flags at the routing layer:
 *   - fuzefront.config.management-console gates /config
 *   - fuzefront.config.key-catalog gates /admin/config/catalog(/:key)
 *   - fuzefront.config.secrets-audit gates /admin/config/keys/:key/history
 * All three default OFF and are net-new routes (nothing to preserve on OFF),
 * matching MemberDirectoryRoute's convention: redirect rather than render
 * nothing, so a stale link never dead-ends the user.
 *
 * Mirrors App.member-directory-flag.test.tsx's mocking shape.
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

vi.mock('../pages/ConfigPage', () => ({
  default: () => <div data-testid="config-page">settings editor</div>,
}))

vi.mock('../pages/ConfigCatalogPage', () => ({
  default: () => <div data-testid="config-catalog-page">key catalog</div>,
}))

vi.mock('../pages/ConfigKeyDefinitionPage', () => ({
  default: () => <div data-testid="config-key-definition-page">key definition</div>,
}))

vi.mock('../pages/ConfigAuditHistoryPage', () => ({
  default: () => <div data-testid="config-audit-history-page">audit history</div>,
}))

const flags: Record<string, boolean> = {
  'fuzefront.config.management-console': false,
  'fuzefront.config.key-catalog': false,
  'fuzefront.config.secrets-audit': false,
}
vi.mock('../platform/featureFlags', async () => {
  const actual = await vi.importActual<typeof import('../platform/featureFlags')>('../platform/featureFlags')
  return {
    ...actual,
    useFlag: (key: string, fallback: boolean) => (key in flags ? flags[key] : fallback),
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
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>
  )
}

describe('Configuration Management Console flags — routing both-states', () => {
  beforeEach(() => {
    flags['fuzefront.config.management-console'] = false
    flags['fuzefront.config.key-catalog'] = false
    flags['fuzefront.config.secrets-audit'] = false
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

  describe('fuzefront.config.management-console — /config', () => {
    it('flag OFF (default): redirects to /dashboard, never renders ConfigPage', async () => {
      setPath('/config')
      renderAt('/config')
      await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
      expect(screen.queryByTestId('config-page')).toBeNull()
    })

    it('flag ON: renders ConfigPage at /config', async () => {
      flags['fuzefront.config.management-console'] = true
      setPath('/config')
      renderAt('/config')
      await waitFor(() => expect(screen.getByTestId('config-page')).toBeTruthy())
    })
  })

  describe('fuzefront.config.key-catalog — /admin/config/catalog(/:key)', () => {
    it('flag OFF (default): the catalog list redirects to /dashboard', async () => {
      setPath('/admin/config/catalog')
      renderAt('/admin/config/catalog')
      await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
      expect(screen.queryByTestId('config-catalog-page')).toBeNull()
    })

    it('flag OFF (default): the definition detail redirects to the catalog list, not /dashboard', async () => {
      setPath('/admin/config/catalog/notifications.digest.frequency')
      renderAt('/admin/config/catalog/notifications.digest.frequency')
      // Redirects to /admin/config/catalog, which itself redirects to /dashboard while the flag is off.
      await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
      expect(screen.queryByTestId('config-key-definition-page')).toBeNull()
    })

    it('flag ON: renders the catalog list and the definition detail', async () => {
      flags['fuzefront.config.key-catalog'] = true
      setPath('/admin/config/catalog')
      renderAt('/admin/config/catalog')
      await waitFor(() => expect(screen.getByTestId('config-catalog-page')).toBeTruthy())

      setPath('/admin/config/catalog/notifications.digest.frequency')
      renderAt('/admin/config/catalog/notifications.digest.frequency')
      await waitFor(() => expect(screen.getByTestId('config-key-definition-page')).toBeTruthy())
    })
  })

  describe('fuzefront.config.secrets-audit — /admin/config/keys/:key/history', () => {
    it('flag OFF (default): redirects to /dashboard', async () => {
      setPath('/admin/config/keys/notifications.provider.apiKey/history')
      renderAt('/admin/config/keys/notifications.provider.apiKey/history')
      await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeTruthy())
      expect(screen.queryByTestId('config-audit-history-page')).toBeNull()
    })

    it('flag ON: renders ConfigAuditHistoryPage', async () => {
      flags['fuzefront.config.secrets-audit'] = true
      setPath('/admin/config/keys/notifications.provider.apiKey/history')
      renderAt('/admin/config/keys/notifications.provider.apiKey/history')
      await waitFor(() => expect(screen.getByTestId('config-audit-history-page')).toBeTruthy())
    })
  })
})
