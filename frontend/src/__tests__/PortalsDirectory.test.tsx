import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PortalsDirectory from '../pages/PortalsDirectory'
import * as adminPortals from '../services/adminPortalsService'
import type { AdminPortal } from '../services/adminPortalsService'

// `useFlag` is mocked per-test (both states are exercised — flag-flags skill's
// "test BOTH states" rule) rather than going through the real fetch-backed
// FeatureFlagProvider.
let flagValue = false
vi.mock('../platform/featureFlags', () => ({
  useFlag: (_key: string, _fallback: boolean) => flagValue,
}))

vi.mock('../services/adminPortalsService', async () => {
  const actual = await vi.importActual<typeof adminPortals>(
    '../services/adminPortalsService'
  )
  return { ...actual, listAdminPortals: vi.fn() }
})

const mocked = adminPortals as unknown as {
  listAdminPortals: ReturnType<typeof vi.fn>
}

function portal(overrides: Partial<AdminPortal>): AdminPortal {
  return {
    id: 'prt_northwind',
    slug: 'northwind',
    name: 'Northwind',
    status: 'active',
    isRoot: false,
    organizationId: 'org-1',
    billingMode: 'platform',
    branding: {} as AdminPortal['branding'],
    identityPolicy: {} as AdminPortal['identityPolicy'],
    domains: [],
    primaryDomain: 'portal.northwind.example',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    identity_mode: 'soft',
    launchUrl: 'https://portal.northwind.example/',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/portals']}>
      <Routes>
        <Route path="/portals" element={<PortalsDirectory />} />
      </Routes>
    </MemoryRouter>
  )
}

function forbiddenError() {
  return { isAxiosError: true, response: { status: 403 }, message: 'Forbidden' }
}

beforeEach(() => {
  vi.clearAllMocks()
  flagValue = false
})

describe('<PortalsDirectory /> — flag gate', () => {
  it('flag OFF (default): renders no directory chrome', async () => {
    flagValue = false
    renderPage()
    expect(screen.getByText(/isn.t available yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Portals you manage')).not.toBeInTheDocument()
    expect(mocked.listAdminPortals).not.toHaveBeenCalled()
  })
})

describe('<PortalsDirectory /> — flag ON, states', () => {
  beforeEach(() => {
    flagValue = true
  })

  it('d1 loading: renders an aria-busy region before the list resolves', async () => {
    mocked.listAdminPortals.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()
    expect(screen.getByLabelText(/loading portals/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/loading portals/i)).toHaveAttribute('aria-busy', 'true')
  })

  it('d2 empty: a real non-error state when the caller manages zero portals', async () => {
    mocked.listAdminPortals.mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } })
    renderPage()
    await waitFor(() => expect(screen.getByText(/no portals to manage/i)).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('d3 error: renders [data-action="retry"] and never a sign-in redirect', async () => {
    mocked.listAdminPortals.mockRejectedValue(new Error('network down'))
    renderPage()
    await waitFor(() => expect(screen.getByText(/couldn.t load your portals/i)).toBeInTheDocument())
    const retry = screen.getByRole('button', { name: /retry/i })
    expect(retry).toHaveAttribute('data-action', 'retry')

    mocked.listAdminPortals.mockResolvedValue({
      items: [portal({})],
      page: { nextCursor: null, hasMore: false },
    })
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument())
  })

  it('renders a soft portal with an unmistakably-external launch anchor', async () => {
    mocked.listAdminPortals.mockResolvedValue({
      items: [portal({ identity_mode: 'soft' })],
      page: { nextCursor: null, hasMore: false },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument())

    const row = screen.getByText('Northwind').closest('[data-portal]') as HTMLElement
    expect(row).toHaveAttribute('data-tier', 'soft')
    expect(row).toHaveAttribute('data-status', 'active')
    expect(within(row).getByText('Soft')).toBeInTheDocument()

    const link = within(row).getByRole('link', { name: /open portal/i })
    expect(link).toHaveAttribute('href', 'https://portal.northwind.example/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('data-action', 'open-portal')
  })

  it('renders a hard-tier portal with the indigo/accent tier badge', async () => {
    mocked.listAdminPortals.mockResolvedValue({
      items: [
        portal({
          id: 'prt_mendys',
          name: 'Mendys Robotics',
          identity_mode: 'hard',
          primaryDomain: 'live.mendysrobotics.com',
          launchUrl: 'https://live.mendysrobotics.com/',
        }),
      ],
      page: { nextCursor: null, hasMore: false },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Mendys Robotics')).toBeInTheDocument())
    const row = screen.getByText('Mendys Robotics').closest('[data-portal]') as HTMLElement
    expect(row).toHaveAttribute('data-tier', 'hard')
    expect(within(row).getByText('Hard')).toBeInTheDocument()
  })

  it('d5 suspended: renders no enabled launch affordance', async () => {
    mocked.listAdminPortals.mockResolvedValue({
      items: [
        portal({
          id: 'prt_acme',
          name: 'Acme Reseller',
          status: 'suspended',
          launchUrl: 'https://portal.acme.example/',
        }),
      ],
      page: { nextCursor: null, hasMore: false },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Reseller')).toBeInTheDocument())
    const row = screen.getByText('Acme Reseller').closest('[data-portal]') as HTMLElement
    expect(within(row).queryByRole('link', { name: /open portal/i })).not.toBeInTheDocument()
    const btn = within(row).getByRole('button', { name: /open portal/i })
    expect(btn).toBeDisabled()
  })

  it('d6 fail-closed permission-denied: 403 renders the panel in place with ZERO launch affordances', async () => {
    mocked.listAdminPortals.mockRejectedValue(forbiddenError())
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/don.t have permission to open portals/i)).toBeInTheDocument()
    )
    const panel = document.querySelector('[data-state="forbidden"]') as HTMLElement
    expect(panel).toHaveAttribute('data-http', '403')
    expect(panel).toHaveAttribute('data-error-code', 'FORBIDDEN')
    expect(document.querySelector('[data-panel="permission-denied"]')).toBeInTheDocument()
    // The load-bearing assertion: NO launch anchor and NO launch button anywhere.
    expect(screen.queryAllByRole('link', { name: /open portal/i })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: /open portal/i })).toHaveLength(0)
  })

  it('a 401 does not render the generic error banner (the global interceptor handles it)', async () => {
    mocked.listAdminPortals.mockRejectedValue({
      isAxiosError: true,
      response: { status: 401 },
      message: 'Unauthorized',
    })
    renderPage()
    await waitFor(() => expect(mocked.listAdminPortals).toHaveBeenCalled())
    expect(screen.queryByText(/couldn.t load your portals/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/permission to open portals/i)).not.toBeInTheDocument()
  })

  it('Load more advances the cursor and appends the next page', async () => {
    mocked.listAdminPortals
      .mockResolvedValueOnce({
        items: [portal({})],
        page: { nextCursor: 'cur_2', hasMore: true },
      })
      .mockResolvedValueOnce({
        items: [portal({ id: 'prt_initech', name: 'Initech', primaryDomain: null as never })],
        page: { nextCursor: null, hasMore: false },
      })
    renderPage()
    await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument())

    const loadMore = screen.getByRole('button', { name: /load more/i })
    expect(loadMore).toHaveAttribute('data-action', 'load-more')
    fireEvent.click(loadMore)

    await waitFor(() => expect(screen.getByText('Initech')).toBeInTheDocument())
    expect(mocked.listAdminPortals).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cur_2' })
    )
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })
})
