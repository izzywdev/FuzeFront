import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PortalBillingPage from '../pages/PortalBillingPage'

vi.mock('../lib/shared', () => ({
  useOrganizations: () => ({
    activeOrganizationId: 'org-northwind',
    activeOrganization: { id: 'org-northwind', name: 'Northwind' },
  }),
}))

vi.mock('../lib/accounts', () => ({
  getActiveAuthToken: () => 'test-token',
}))

const flagState = { resellerConnectEnabled: false }
vi.mock('../platform/featureFlags', () => ({
  useFlag: (key: string, fallback: boolean) =>
    key === 'fuzefront.billing.reseller-connect' ? flagState.resellerConnectEnabled : fallback,
}))

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status',
    text: async () => JSON.stringify(body),
  } as Response)
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/portal/admin/billing']}>
      <Routes>
        <Route path="/portal/admin/billing" element={<PortalBillingPage />} />
        <Route path="/billing/invoices" element={<div>Invoices route</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PortalBillingPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    flagState.resellerConnectEnabled = false
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the real platform subscription via the same-origin billing client and renders it', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/billing/subscriptions')) {
        return jsonResponse(200, {
          subscription: {
            id: 'sub_1',
            customerId: 'cus_1',
            subscriptionId: 'sub_1',
            priceId: 'price_pro',
            planTier: 'pro',
            status: 'active',
            seatQuantity: 1,
            trialStart: null,
            trialEnd: null,
            currentPeriodStart: null,
            currentPeriodEnd: '2026-08-01T00:00:00.000Z',
            cancelAtPeriodEnd: false,
            canceledAt: null,
          },
        })
      }
      if (url.startsWith('/api/v1/billing/plans')) {
        return jsonResponse(200, {
          plans: [
            {
              priceId: 'price_pro',
              productId: 'prod_pro',
              tierName: 'pro',
              displayName: 'Pro',
              billingInterval: 'month',
              unitAmount: 19900,
              currency: 'usd',
              seatBased: false,
              meteredMeterName: null,
              features: [],
              isActive: true,
              sortOrder: 1,
            },
          ],
        })
      }
      return jsonResponse(404, {})
    })

    renderPage()

    expect(await screen.findByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    // Called against the SAME-ORIGIN relative path — never an absolute host.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/subscriptions?organizationId=org-northwind',
      expect.anything(),
    )
  })

  it('renders the fail-closed access-denied panel on a 403 from the billing proxy (non-portal-admin)', async () => {
    fetchMock.mockImplementation(() => jsonResponse(403, { error: 'forbidden', code: 'ORG_PERMISSION_DENIED' }))
    renderPage()
    expect(await screen.findByText("You don't have access to this portal's billing")).toBeInTheDocument()
  })

  it('reseller-connect flag OFF: renders the honest placeholder and never calls the anticipated endpoints', async () => {
    flagState.resellerConnectEnabled = false
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/billing/subscriptions')) return jsonResponse(200, { subscription: null })
      if (url.startsWith('/api/v1/billing/plans')) return jsonResponse(200, { plans: [] })
      throw new Error(`unexpected call to ${url}`)
    })
    renderPage()
    expect(await screen.findByText("Reseller payouts aren't enabled yet")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/v1/portal/connect'), expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/v1/portal/price-book'), expect.anything())
  })
})
