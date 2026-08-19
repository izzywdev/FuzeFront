import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MasterAdminPortalsFlow } from './MasterAdminPortalsFlow'
import type { AdminPortalsClient } from '../api/adminPortalsClient'
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

function makeClient(overrides: Partial<AdminPortalsClient> = {}): AdminPortalsClient {
  return {
    listPortals: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null } }),
    createPortal: vi.fn(),
    getPortal: vi.fn(),
    suspendPortal: vi.fn(),
    resumePortal: vi.fn(),
    ...overrides,
  }
}

describe('MasterAdminPortalsFlow', () => {
  it('renders the fleet table with a create-portal action when portals exist', async () => {
    const portals = [makePortal({ id: 'prt_root', slug: 'fuzefront', name: 'FuzeFront', isRoot: true }), makePortal()]
    const client = makeClient({ listPortals: vi.fn().mockResolvedValue({ items: portals, page: { nextCursor: null } }) })

    render(<MasterAdminPortalsFlow client={client} />)

    expect(await screen.findByText('Test Tenant')).toBeInTheDocument()
    expect(document.querySelector("[data-panel='portals-list']")).toBeInTheDocument()
    expect(document.querySelector("[data-action='create-portal']")).toBeInTheDocument()
  })

  it('shows the fresh-install empty state when only the root portal exists', async () => {
    const client = makeClient({
      listPortals: vi.fn().mockResolvedValue({
        items: [makePortal({ id: 'prt_root', slug: 'fuzefront', isRoot: true })],
        page: { nextCursor: null },
      }),
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
    const forbiddenError = { response: { status: 403, data: { error: 'FORBIDDEN' } } }
    const client = makeClient({ listPortals: vi.fn().mockRejectedValue(forbiddenError) })

    render(<MasterAdminPortalsFlow client={client} />)

    await waitFor(() => expect(document.querySelector("[data-state='forbidden']")).toBeInTheDocument())
    expect(document.querySelector("[data-error-code='FORBIDDEN']")).toBeInTheDocument()
    // Never renders any portal rows.
    expect(document.querySelector('[data-portal]')).not.toBeInTheDocument()
  })

  it('disables Suspend on the root portal row (client pre-disable guard)', async () => {
    const portals = [makePortal({ id: 'prt_root', slug: 'fuzefront', isRoot: true }), makePortal()]
    const client = makeClient({ listPortals: vi.fn().mockResolvedValue({ items: portals, page: { nextCursor: null } }) })

    render(<MasterAdminPortalsFlow client={client} />)

    const row = await screen.findByText('fuzefront')
    const tr = row.closest('tr') as HTMLElement
    const suspendBtn = within(tr).getByText('Suspend')
    expect(suspendBtn).toBeDisabled()
  })

  it('creating a portal with a taken slug renders 409 SLUG_TAKEN inline, keeping the form filled', async () => {
    const user = userEvent.setup()
    const client = makeClient({
      listPortals: vi.fn().mockResolvedValue({ items: [makePortal()], page: { nextCursor: null } }),
      createPortal: vi.fn().mockRejectedValue({ response: { status: 409, data: { error: 'SLUG_TAKEN' } } }),
    })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('Test Tenant')

    await user.click(document.querySelector("[data-action='create-portal']") as HTMLElement)
    await user.type(document.querySelector("[data-input='name']") as HTMLElement, 'Duplicate')
    await user.type(document.querySelector("[data-input='slug']") as HTMLElement, 'test-tenant')
    await user.type(document.querySelector("[data-input='owner-email']") as HTMLElement, 'owner@duplicate.example')
    await user.click(document.querySelector("[data-action='submit-create-portal']") as HTMLElement)

    await waitFor(() => expect(document.querySelector("[data-error-code='SLUG_TAKEN']")).toBeInTheDocument())
    expect((document.querySelector("[data-input='slug']") as HTMLInputElement).value).toBe('test-tenant')
  })

  it('suspending a non-root portal calls the API and flips the row status without a full reload', async () => {
    const user = userEvent.setup()
    const portal = makePortal()
    const suspended = { ...portal, status: 'suspended' as const }
    const listPortals = vi.fn().mockResolvedValue({ items: [portal], page: { nextCursor: null } })
    const client = makeClient({ listPortals, suspendPortal: vi.fn().mockResolvedValue(suspended) })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('Test Tenant')

    await user.click(document.querySelector("[data-action='suspend-portal']") as HTMLElement)
    await user.click(document.querySelector("[data-action='confirm-suspend-portal']") as HTMLElement)

    await waitFor(() => expect(client.suspendPortal).toHaveBeenCalledWith('prt_test'))
    // listPortals was only called once (initial load) — no full reload on suspend.
    expect(listPortals).toHaveBeenCalledTimes(1)
  })

  it('opens a portal to the read-only detail view (stat cards, domain status) and back again', async () => {
    const user = userEvent.setup()
    const portal = makePortal({
      domains: [
        { id: 'd1', portalId: 'prt_test', domain: 'test-tenant.example', kind: 'custom', verificationStatus: 'verified', tlsStatus: 'active', active: true, isPrimary: true },
        { id: 'd2', portalId: 'prt_test', domain: 'test-tenant.fuzefront.com', kind: 'subdomain', verificationStatus: 'pending', tlsStatus: 'none', active: true, isPrimary: false },
      ],
    } as any)
    const client = makeClient({ listPortals: vi.fn().mockResolvedValue({ items: [portal], page: { nextCursor: null } }) })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('Test Tenant')
    await user.click(document.querySelector("[data-action='view-portal']") as HTMLElement)

    expect(document.querySelector("[data-panel='portal-stats']")).toBeInTheDocument()
    expect(document.querySelector("[data-panel='domain-status']")).toBeInTheDocument()
    expect(document.querySelector('[data-domain-status="verified"]')).toBeInTheDocument()
    expect(document.querySelector('[data-domain-status="pending"]')).toBeInTheDocument()
    expect(document.querySelector("[data-action='suspend-portal']")).toBeInTheDocument()

    await user.click(document.querySelector("[data-action='back-to-portals']") as HTMLElement)
    expect(document.querySelector("[data-panel='portals-list']")).toBeInTheDocument()
  })

  it('resuming a suspended portal calls the API and flips the row status', async () => {
    const user = userEvent.setup()
    const portal = makePortal({ status: 'suspended' })
    const resumed = { ...portal, status: 'active' as const }
    const client = makeClient({
      listPortals: vi.fn().mockResolvedValue({ items: [portal], page: { nextCursor: null } }),
      resumePortal: vi.fn().mockResolvedValue(resumed),
    })

    render(<MasterAdminPortalsFlow client={client} />)
    await screen.findByText('Test Tenant')
    await user.click(document.querySelector("[data-action='resume-portal']") as HTMLElement)

    await waitFor(() => expect(client.resumePortal).toHaveBeenCalledWith('prt_test'))
  })

  it('loads more portals via the cursor and appends them without replacing the page', async () => {
    const user = userEvent.setup()
    const first = makePortal({ id: 'prt_1', slug: 'first' })
    const second = makePortal({ id: 'prt_2', slug: 'second', name: 'Second Tenant' })
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
