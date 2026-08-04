/**
 * DashboardPage.org-app-visibility.test.tsx
 *
 * Regression cover for the prod BUG 2: a Google/social-login user saw
 * "No applications available" on the dashboard while the sidebar (backed by
 * the same `@fuzeone/app-registry-client` registry) correctly listed all 3
 * activated apps. Root cause: DashboardPage read a different, legacy
 * `fetchApps()` (`GET /apps`) source instead of `useRegisteredApps()`
 * (`GET /api/v1/app-registry/apps?status=activated`) — the one source that
 * had actually returned the 3 apps (with `organizationId: null`) live.
 *
 * These tests pin:
 *   1. isAppVisibleForOrg keeps `organizationId: null` (platform-global) apps
 *      visible regardless of the active org — including when org hydration
 *      hasn't completed yet (`activeOrganizationId === null`).
 *   2. DashboardPage renders apps sourced from `useRegisteredApps()` (the
 *      same registry the sidebar/SidePanel consumes), not the legacy list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { App as RegistryApp } from '@fuzeone/app-registry-client'

vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>(
    '../lib/shared'
  )
  return {
    ...actual,
    useCurrentUser: vi.fn(),
    useOrganizations: vi.fn(),
  }
})

const mockUseRegisteredApps = vi.fn()
vi.mock('../platform/appRegistry', () => ({
  useRegisteredApps: () => mockUseRegisteredApps(),
}))

import DashboardPage, { isAppVisibleForOrg } from '../pages/DashboardPage'
import * as sharedMock from '../lib/shared'

function makeApp(overrides: Partial<RegistryApp> = {}): RegistryApp {
  return {
    slug: 'clock',
    status: 'activated',
    mode: 'portal',
    builtin: true,
    organizationId: null,
    isHealthy: true,
    lastSeenAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    manifest: {
      manifestVersion: '1',
      slug: 'clock',
      name: 'Clock',
      menuLabel: 'Clock',
      mode: 'portal',
      integration: { type: 'module-federation' } as any,
    } as any,
    ...overrides,
  } as RegistryApp
}

describe('isAppVisibleForOrg (BUG 2 filter unit)', () => {
  it('shows a platform-global app (organizationId: null) when an org is active', () => {
    expect(isAppVisibleForOrg({ organizationId: null }, 'org-1')).toBe(true)
  })

  it('shows a platform-global app when org hydration has not completed yet (activeOrganizationId null)', () => {
    expect(isAppVisibleForOrg({ organizationId: null }, null)).toBe(true)
  })

  it('shows an app scoped to the active organization', () => {
    expect(isAppVisibleForOrg({ organizationId: 'org-1' }, 'org-1')).toBe(true)
  })

  it('hides an app scoped to a DIFFERENT organization', () => {
    expect(isAppVisibleForOrg({ organizationId: 'org-2' }, 'org-1')).toBe(false)
  })
})

describe('DashboardPage (BUG 2 regression)', () => {
  beforeEach(() => {
    vi.mocked(sharedMock.useCurrentUser).mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', roles: [], firstName: 'Ada' },
      currentUser: null,
      isAuthenticated: true,
      setUser: vi.fn(),
      setCurrentUser: vi.fn(),
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders platform-global apps (organizationId: null) from the registry even with an active org set', async () => {
    vi.mocked(sharedMock.useOrganizations).mockReturnValue({
      organizations: [],
      activeOrganizationId: '25b9fc00-8a6f-4215-b9bb-002d898b967e',
      activeOrganization: null,
      setActiveOrganization: vi.fn(),
    } as any)
    mockUseRegisteredApps.mockReturnValue({
      apps: [
        makeApp({ slug: 'fuzesocial', manifest: { ...makeApp().manifest, menuLabel: 'FuzeSocial' } as any }),
        makeApp({ slug: 'fuzeagent', manifest: { ...makeApp().manifest, menuLabel: 'FuzeAgent' } as any }),
        makeApp({ slug: 'clock', manifest: { ...makeApp().manifest, menuLabel: 'Clock' } as any }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('FuzeSocial')).toBeTruthy())
    expect(screen.getByText('FuzeAgent')).toBeTruthy()
    expect(screen.getByText('Clock')).toBeTruthy()
    expect(screen.queryByText(/No applications available/i)).toBeNull()
  })

  it('renders the same apps even before org hydration completes (activeOrganizationId null)', async () => {
    vi.mocked(sharedMock.useOrganizations).mockReturnValue({
      organizations: [],
      activeOrganizationId: null,
      activeOrganization: null,
      setActiveOrganization: vi.fn(),
    } as any)
    mockUseRegisteredApps.mockReturnValue({
      apps: [makeApp()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('Clock')).toBeTruthy())
  })

  it('shows the empty state when the registry genuinely has no visible apps', async () => {
    vi.mocked(sharedMock.useOrganizations).mockReturnValue({
      organizations: [],
      activeOrganizationId: 'org-1',
      activeOrganization: null,
      setActiveOrganization: vi.fn(),
    } as any)
    mockUseRegisteredApps.mockReturnValue({
      apps: [makeApp({ organizationId: 'org-2' })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    render(<DashboardPage />)

    await waitFor(() =>
      expect(screen.getByText(/No applications available/i)).toBeTruthy()
    )
  })
})
