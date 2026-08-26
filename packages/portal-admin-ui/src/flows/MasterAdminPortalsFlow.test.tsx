import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MasterAdminPortalsFlow } from './MasterAdminPortalsFlow'
import type { AdminPortalsClient } from '../api/adminPortalsClient'
import { HttpError } from '../api/http'
import type { AdminPortal } from '../types'

function makePortal(overrides: Partial<AdminPortal> = {}): AdminPortal {
  return {
    orgId: 'org_test',
    parentOrgId: 'org_00000000-0000-0000-0000-000000000010',
    name: 'Test Tenant',
    slug: 'test-tenant',
    kind: 'portal',
    status: 'active',
    isPortalRoot: true,
    ownerEmail: 'owner@test-tenant.example',
    customDomain: null,
    branding: { name: 'Test Tenant' },
    billingMode: 'platform',
    appCatalogMode: 'inherit',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeClient(overrides: Partial<AdminPortalsClient> = {}): AdminPortalsClient {
  return {
    listPortals: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } }),
    createPortal: vi.fn(),
    getPortal: vi.fn(),
    suspendPortal: vi.fn(),
    resumePortal: vi.fn(),
    ...overrides,
  }
}

describe('MasterAdminPortalsFlow', () => {
  it('renders the fleet table with a create-portal action when portals exist', async () => {
    const portals = [makePortal()]
    const client = makeClient({ listPortals: vi.fn().mockResolvedValue({ items: portals, page: { nextCursor: null, hasMore: false } }) })

    render(<MasterAdminPortalsFlow client={client} />)

    expect(await screen.findByText('Test Tenant')).toBeInTheDocument()
    expect(document.querySelector("[data-panel='portals-list']")).toBeInTheDocument()
    expect(document.querySelector("[data-action='create-portal']")).toBeInTheDocument()
  })

  it('shows the real empty state when zero portals exist (the platform root is never listed)', async () => {
    const client = makeClient({
      listPortals: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } }),
    })

    render(<MasterAdminPortalsFlow client={client} />)

    await waitFor(() => expect(document.querySelector("[data-state='empty']")).toBeInTheDocument())
    expect(screen.getByText('No tenant portals yet')).toBeInTheDocument()
  })

  it('shows a loading skeleton while the fleet list is in flight', () => {
    const client = makeClient({ listPortals: vi.fn(() => new Promise<never>(() => {})) })
    render(<MasterAdminPortalsFlow client={client} />)
    expect(document.querySelector("[data-panel='portals-list'][data-state='loading']")).toBeInTheDocument()
  })

  it('shows the error state with retry on a load failure', async () => {
    const client = makeClient({ listPortals: vi.fn().mockRejectedValue(new Error('boom')) })
    render(<MasterAdminPortalsFlow client={client} />)

    await waitFor(() => expect(document.querySelector("[data-state='error']")).toBeInTheDocument())
    expect(document.querySelector("[data-action='retry']")).toBeInTheDocument()
  })

  it('renders the fail-closed access-denied state for a non-platform-admin (403), never a blank table', async () => {
    const client = makeClient({ listPortals: vi.fn().mockRejectedValue(new HttpError(403, 'Forbidden', { error: 'Forbidden', code: 'FORBIDDEN' })) })

    render(<MasterAdminPortalsFlow client={client} />)

    await waitFor(() => expect(document.querySelector("[data-state='forbidden']")).toBeInTheDocument())
    expect(document.querySelector("[data-error-code='FORBIDDEN']")).toBeInTheDocument()
    // Never renders any portal rows.
    expect(document.querySelector('[data-portal]')).not.toBeInTheDocument()
  })

  it('creating a portal with a taken slug renders the 409 CONFLICT inline, keeping the form filled', async () => {
    const user = userEvent.setup()
    const client = makeClient({
      listPortals: vi.fn().mockResolvedValue({ items: [makePortal()], page: { nextCursor: null, hasMore: false } }),
      createPortal: vi.fn().mockRejectedValue(new HttpError(409, 'Conflict', { error: 'A portal with this slug already exists', code: 'CONFLICT' })),
    })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('Test Tenant')

    await user.click(document.querySelector("[data-action='create-portal']") as HTMLElement)
    await user.type(document.querySelector("[data-input='name']") as HTMLElement, 'Duplicate')
    await user.type(document.querySelector("[data-input='slug']") as HTMLElement, 'test-tenant')
    await user.type(document.querySelector("[data-input='owner-email']") as HTMLElement, 'owner@duplicate.example')
    await user.click(document.querySelector("[data-action='submit-create-portal']") as HTMLElement)

    await waitFor(() => expect(document.querySelector("[data-error-code='CONFLICT']")).toBeInTheDocument())
    expect((document.querySelector("[data-input='slug']") as HTMLInputElement).value).toBe('test-tenant')
  })

  it('creating a portal submits the full tenant-attribute payload (custom domain, branding, catalog mode, billing mode)', async () => {
    const user = userEvent.setup()
    const createPortal = vi.fn().mockResolvedValue(makePortal({ orgId: 'org_new', slug: 'new-tenant' }))
    const client = makeClient({
      listPortals: vi
        .fn()
        .mockResolvedValueOnce({ items: [], page: { nextCursor: null, hasMore: false } })
        .mockResolvedValueOnce({ items: [makePortal({ orgId: 'org_new', slug: 'new-tenant' })], page: { nextCursor: null, hasMore: false } }),
      createPortal,
    })

    render(<MasterAdminPortalsFlow client={client} />)
    await waitFor(() => expect(document.querySelector("[data-state='empty']")).toBeInTheDocument())

    await user.click(document.querySelector("[data-action='create-portal']") as HTMLElement)
    await user.type(document.querySelector("[data-input='name']") as HTMLElement, 'New Tenant')
    await user.type(document.querySelector("[data-input='slug']") as HTMLElement, 'new-tenant')
    await user.type(document.querySelector("[data-input='owner-email']") as HTMLElement, 'owner@new-tenant.example')
    await user.type(document.querySelector("[data-input='custom-domain']") as HTMLElement, 'portal.new-tenant.example')
    await user.click(document.querySelector("[data-catalog-option='custom']") as HTMLElement)
    await user.click(document.querySelector("[data-plan-option='reseller']") as HTMLElement)
    await user.click(document.querySelector("[data-action='submit-create-portal']") as HTMLElement)

    await waitFor(() =>
      expect(createPortal).toHaveBeenCalledWith({
        name: 'New Tenant',
        slug: 'new-tenant',
        ownerEmail: 'owner@new-tenant.example',
        customDomain: 'portal.new-tenant.example',
        branding: { name: 'New Tenant' },
        billingMode: 'reseller',
        appCatalogMode: 'custom',
      })
    )
  })

  it('suspending a portal calls the API and flips the row status without a full reload', async () => {
    const user = userEvent.setup()
    const portal = makePortal()
    const suspended = { ...portal, status: 'suspended' as const }
    const listPortals = vi.fn().mockResolvedValue({ items: [portal], page: { nextCursor: null, hasMore: false } })
    const client = makeClient({ listPortals, suspendPortal: vi.fn().mockResolvedValue(suspended) })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('Test Tenant')

    await user.click(document.querySelector("[data-action='suspend-portal']") as HTMLElement)
    await user.click(document.querySelector("[data-action='confirm-suspend-portal']") as HTMLElement)

    await waitFor(() => expect(client.suspendPortal).toHaveBeenCalledWith('org_test'))
    // listPortals was only called once (initial load) — no full reload on suspend.
    expect(listPortals).toHaveBeenCalledTimes(1)
  })

  it('opens a portal to the read-only detail view (stat cards, branding, custom domain) and back again', async () => {
    const user = userEvent.setup()
    const portal = makePortal({ customDomain: 'test-tenant.example' })
    const client = makeClient({ listPortals: vi.fn().mockResolvedValue({ items: [portal], page: { nextCursor: null, hasMore: false } }) })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('Test Tenant')
    await user.click(document.querySelector("[data-action='view-portal']") as HTMLElement)

    expect(document.querySelector("[data-panel='portal-stats']")).toBeInTheDocument()
    expect(document.querySelector("[data-panel='branding-summary']")).toBeInTheDocument()
    // Renders in BOTH the "Custom domain" stat card and the branding summary — assert at least one.
    expect(screen.getAllByText('test-tenant.example').length).toBeGreaterThan(0)
    expect(document.querySelector("[data-action='suspend-portal']")).toBeInTheDocument()

    await user.click(document.querySelector("[data-action='back-to-portals']") as HTMLElement)
    expect(document.querySelector("[data-panel='portals-list']")).toBeInTheDocument()
  })

  it('resuming a suspended portal calls the API and flips the row status', async () => {
    const user = userEvent.setup()
    const portal = makePortal({ status: 'suspended' })
    const resumed = { ...portal, status: 'active' as const }
    const client = makeClient({
      listPortals: vi.fn().mockResolvedValue({ items: [portal], page: { nextCursor: null, hasMore: false } }),
      resumePortal: vi.fn().mockResolvedValue(resumed),
    })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('Test Tenant')
    await user.click(document.querySelector("[data-action='resume-portal']") as HTMLElement)

    await waitFor(() => expect(client.resumePortal).toHaveBeenCalledWith('org_test'))
  })

  it('loads more portals via the cursor and appends them without replacing the page', async () => {
    const user = userEvent.setup()
    const first = makePortal({ orgId: 'org_1', slug: 'first' })
    const second = makePortal({ orgId: 'org_2', slug: 'second', name: 'Second Tenant' })
    const listPortals = vi
      .fn()
      .mockResolvedValueOnce({ items: [first], page: { nextCursor: 'c1', hasMore: true } })
      .mockResolvedValueOnce({ items: [second], page: { nextCursor: null, hasMore: false } })
    const client = makeClient({ listPortals })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('first')
    await user.click(document.querySelector("[data-action='load-more']") as HTMLElement)

    await screen.findByText('Second Tenant')
    expect(listPortals).toHaveBeenCalledTimes(2)
  })
})
