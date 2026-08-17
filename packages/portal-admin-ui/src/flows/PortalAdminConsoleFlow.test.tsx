import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PortalAdminConsoleFlow } from './PortalAdminConsoleFlow'
import type { PortalConsoleClient } from '../api/portalConsoleClient'
import type { Portal } from '../types'

function makePortal(overrides: Partial<Portal> = {}): Portal {
  return {
    id: 'prt_test',
    slug: 'test-tenant',
    name: 'Test Tenant',
    status: 'active',
    isRoot: false,
    organizationId: 'org_1',
    ownerEmail: 'owner@test-tenant.example',
    billingMode: 'platform',
    domains: [],
    ...overrides,
  } as Portal
}

function makeClient(overrides: Partial<PortalConsoleClient> = {}): PortalConsoleClient {
  return {
    getCurrentPortal: vi.fn().mockResolvedValue(makePortal()),
    listUsers: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null } }),
    searchUsers: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null } }),
    listOrgMembers: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null } }),
    listInvitations: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null } }),
    createInvitation: vi.fn(),
    resendInvitation: vi.fn().mockResolvedValue(undefined),
    revokeInvitation: vi.fn().mockResolvedValue(undefined),
    listRegistryApps: vi.fn().mockResolvedValue([]),
    listPortalCatalog: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null } }),
    enableCatalogApp: vi.fn(),
    updateCatalogEntry: vi.fn(),
    disableCatalogApp: vi.fn(),
    ...overrides,
  }
}

describe('PortalAdminConsoleFlow', () => {
  it('renders the tabbed console shell with Overview/Users/App-catalog', async () => {
    const client = makeClient()
    render(<PortalAdminConsoleFlow client={client} />)

    await screen.findByText('Test Tenant · Console')
    expect(document.querySelector("[data-panel='portal-tabs']")).toBeInTheDocument()
    expect(document.querySelector("[data-tab='overview']")).toBeInTheDocument()
    expect(document.querySelector("[data-tab='users']")).toBeInTheDocument()
    expect(document.querySelector("[data-tab='catalog']")).toBeInTheDocument()
  })

  it('resolves the portal from the session — never a client-supplied portalId', async () => {
    const getCurrentPortal = vi.fn().mockResolvedValue(makePortal())
    const client = makeClient({ getCurrentPortal })
    render(<PortalAdminConsoleFlow client={client} />)

    await screen.findByText('Test Tenant · Console')
    expect(getCurrentPortal).toHaveBeenCalledWith()
    expect(getCurrentPortal.mock.calls[0]).toHaveLength(0)
  })

  it('renders a suspended portal as a fail-closed 403 for the WHOLE console, never a redirect', async () => {
    const client = makeClient({
      getCurrentPortal: vi.fn().mockRejectedValue({ status: 403, code: 'PORTAL_SUSPENDED' }),
    })
    render(<PortalAdminConsoleFlow client={client} />)

    await waitFor(() => expect(document.querySelector("[data-state='suspended']")).toBeInTheDocument())
    expect(document.querySelector("[data-error-code='PORTAL_SUSPENDED']")).toBeInTheDocument()
    expect(document.querySelector("[data-panel='portal-tabs']")).not.toBeInTheDocument()
  })

  it('renders a generic 403 as the forbidden state, not the fleet', async () => {
    const client = makeClient({
      getCurrentPortal: vi.fn().mockRejectedValue({ status: 403, code: 'FORBIDDEN_PORTAL' }),
    })
    render(<PortalAdminConsoleFlow client={client} />)

    await waitFor(() => expect(document.querySelector("[data-error-code='FORBIDDEN_PORTAL']")).toBeInTheDocument())
  })

  it('shows the load-error state with retry when the portal fails to load', async () => {
    const client = makeClient({ getCurrentPortal: vi.fn().mockRejectedValue(new Error('boom')) })
    render(<PortalAdminConsoleFlow client={client} />)

    await waitFor(() => expect(document.querySelector("[data-state='error']")).toBeInTheDocument())
    expect(document.querySelector("[data-action='retry']")).toBeInTheDocument()
  })

  describe('Users tab', () => {
    it('renders portal-scoped members with role pill and invited status, and disables self-role-change', async () => {
      const client = makeClient({
        listOrgMembers: vi.fn().mockResolvedValue({
          items: [
            { membershipId: 'm1', role: 'admin', status: 'active', joinedAt: null, user: { id: 'u_self', email: 'me@test-tenant.example', firstName: null, lastName: null, homePortalId: 'prt_test' } },
            { membershipId: 'm2', role: 'member', status: 'active', joinedAt: null, user: { id: 'u_other', email: 'other@test-tenant.example', firstName: null, lastName: null, homePortalId: 'prt_test' } },
          ],
          page: { nextCursor: null },
        }),
        listInvitations: vi.fn().mockResolvedValue({
          items: [{ id: 'inv1', organizationId: 'org_1', email: 'invited@test-tenant.example', role: 'member', status: 'pending', expiresAt: null, createdAt: null }],
          page: { nextCursor: null },
        }),
      })
      const user = userEvent.setup()

      render(<PortalAdminConsoleFlow client={client} currentUserId="u_self" />)
      await screen.findByText('Test Tenant · Console')
      await user.click(document.querySelector("[data-tab='users']") as HTMLElement)

      await screen.findByText('me@test-tenant.example')
      expect(document.querySelector("[data-role-pill='admin']")).toBeInTheDocument()
      expect(document.querySelector("[data-user-status='invited']")).toBeInTheDocument()

      const selfRow = document.querySelector("[data-self='true']") as HTMLElement
      expect(within(selfRow).getByText('Change role')).toBeDisabled()
    })

    it('shows the "just you" empty state for a newly-provisioned portal', async () => {
      const client = makeClient({
        listOrgMembers: vi.fn().mockResolvedValue({
          items: [{ membershipId: 'm1', role: 'admin', status: 'active', joinedAt: null, user: { id: 'u_self', email: 'me@test-tenant.example', firstName: null, lastName: null, homePortalId: 'prt_test' } }],
          page: { nextCursor: null },
        }),
      })
      const user = userEvent.setup()
      render(<PortalAdminConsoleFlow client={client} currentUserId="u_self" />)
      await screen.findByText('Test Tenant · Console')
      await user.click(document.querySelector("[data-tab='users']") as HTMLElement)

      await waitFor(() => expect(document.querySelector("[data-panel='portal-users'][data-state='ready']")).toBeInTheDocument())
      expect(screen.getByText("It's just you so far")).toBeInTheDocument()
    })

    it('invites a user via the real POST /organizations/:id/invitations', async () => {
      const createInvitation = vi.fn().mockResolvedValue({ id: 'inv2', organizationId: 'org_1', email: 'teammate@test-tenant.example', role: 'member', status: 'pending', expiresAt: null, createdAt: null })
      const client = makeClient({ createInvitation })
      const user = userEvent.setup()

      render(<PortalAdminConsoleFlow client={client} currentUserId="u_self" />)
      await screen.findByText('Test Tenant · Console')
      await user.click(document.querySelector("[data-tab='users']") as HTMLElement)
      await waitFor(() => expect(document.querySelector("[data-action='invite-user']")).toBeInTheDocument())
      await user.click(document.querySelector("[data-action='invite-user']") as HTMLElement)

      await user.type(document.querySelector("[data-input='email']") as HTMLElement, 'teammate@test-tenant.example')
      await user.click(document.querySelector("[data-action='submit-invite']") as HTMLElement)

      await waitFor(() => expect(createInvitation).toHaveBeenCalledWith('org_1', 'teammate@test-tenant.example', 'member'))
    })

    it('inviting into a portal you do not administer is denied 403 FORBIDDEN_PORTAL — zero cross-tenant leak', async () => {
      const client = makeClient({ createInvitation: vi.fn().mockRejectedValue({ status: 403 }) })
      const user = userEvent.setup()

      render(<PortalAdminConsoleFlow client={client} currentUserId="u_self" />)
      await screen.findByText('Test Tenant · Console')
      await user.click(document.querySelector("[data-tab='users']") as HTMLElement)
      await waitFor(() => expect(document.querySelector("[data-action='invite-user']")).toBeInTheDocument())
      await user.click(document.querySelector("[data-action='invite-user']") as HTMLElement)
      await user.type(document.querySelector("[data-input='email']") as HTMLElement, 'someone@other-portal.example')
      await user.click(document.querySelector("[data-action='submit-invite']") as HTMLElement)

      await waitFor(() => expect(document.querySelector("[data-error-code='FORBIDDEN_PORTAL']")).toBeInTheDocument())
      expect(document.body.textContent).not.toContain('other-portal')
    })
  })

  describe('App-catalog tab (fuzefront.apps.portal-catalog — both states)', () => {
    it('flag OFF: renders a not-available placeholder, never fetches the catalog', async () => {
      const listPortalCatalog = vi.fn()
      const client = makeClient({ listPortalCatalog })
      const user = userEvent.setup()

      render(<PortalAdminConsoleFlow client={client} catalogEnabled={false} />)
      await screen.findByText('Test Tenant · Console')
      await user.click(document.querySelector("[data-tab='catalog']") as HTMLElement)

      expect(document.querySelector("[data-panel='catalog-enabled'][data-state='disabled']")).toBeInTheDocument()
      expect(listPortalCatalog).not.toHaveBeenCalled()
    })

    it('flag ON: renders the enabled apps and an empty state when nothing is curated', async () => {
      const client = makeClient({ listPortalCatalog: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null } }) })
      const user = userEvent.setup()

      render(<PortalAdminConsoleFlow client={client} catalogEnabled />)
      await screen.findByText('Test Tenant · Console')
      await user.click(document.querySelector("[data-tab='catalog']") as HTMLElement)

      await waitFor(() => expect(document.querySelector("[data-panel='catalog-enabled'][data-state='ready']")).toBeInTheDocument())
      expect(screen.getByText('No apps in your portal yet')).toBeInTheDocument()
    })

    it('flag ON: enabling an app from the catalog calls the real per-portal catalog API', async () => {
      const enableCatalogApp = vi.fn().mockResolvedValue({ portalId: 'prt_test', appId: 'app_1', enabled: true, pinnedOrder: 0, config: {}, createdAt: '', updatedAt: '' })
      const client = makeClient({
        listRegistryApps: vi.fn().mockResolvedValue([{ id: 'app_1', name: 'Helpdesk', integrationType: 'module-federation', iconUrl: null, isHealthy: true }]),
        enableCatalogApp,
      })
      const user = userEvent.setup()

      render(<PortalAdminConsoleFlow client={client} catalogEnabled />)
      await screen.findByText('Test Tenant · Console')
      await user.click(document.querySelector("[data-tab='catalog']") as HTMLElement)
      await waitFor(() => expect(document.querySelector("[data-action='add-app']")).toBeInTheDocument())
      await user.click(document.querySelector("[data-action='add-app']") as HTMLElement)

      await screen.findByText('Helpdesk')
      await user.click(document.querySelector("[data-action='enable-app']") as HTMLElement)

      await waitFor(() => expect(enableCatalogApp).toHaveBeenCalledWith('prt_test', 'app_1', 0))
    })
  })
})
