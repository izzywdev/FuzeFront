import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import BillingPage from '../pages/BillingPage'
import * as billing from '../services/billingService'

// The page reads only `useOrganizations` from lib/shared — mock it to a fixed
// org so we don't need the full AppProvider tree.
vi.mock('../lib/shared', () => ({
  useOrganizations: () => ({ activeOrganizationId: 'org-1' }),
}))

vi.mock('../services/billingService', () => ({
  listPlans: vi.fn(),
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  listInvoices: vi.fn(),
  createBillingPortalSession: vi.fn(),
  // Keep the formatting helpers real-ish (deterministic) so card content asserts.
  formatPlanAmount: (p: { priceCents?: number }) =>
    p.priceCents != null ? `$${(p.priceCents / 100).toFixed(2)}` : '—',
  planInterval: (p: { interval?: string }) => p.interval,
  formatInvoiceAmount: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}))

const mocked = billing as unknown as {
  listPlans: ReturnType<typeof vi.fn>
  getSubscription: ReturnType<typeof vi.fn>
  createCheckoutSession: ReturnType<typeof vi.fn>
  listInvoices: ReturnType<typeof vi.fn>
  createBillingPortalSession: ReturnType<typeof vi.fn>
}

const PLANS = [
  {
    id: 'price_basic',
    name: 'Basic',
    displayName: 'Basic',
    priceCents: 900,
    currency: 'usd',
    interval: 'month',
    features: ['1 workspace', 'Email support'],
  },
  {
    id: 'price_pro',
    name: 'Pro',
    displayName: 'Pro',
    priceCents: 2900,
    currency: 'usd',
    interval: 'month',
    features: ['Unlimited workspaces', 'Priority support'],
  },
]

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/billing/invoices" element={<BillingPage />} />
        <Route path="/billing/payments" element={<BillingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getSubscription.mockResolvedValue(undefined)
  mocked.listPlans.mockResolvedValue(PLANS)
  mocked.listInvoices.mockResolvedValue({ invoices: [], nextCursor: null })
  mocked.createCheckoutSession.mockResolvedValue({ url: 'https://checkout' })
  mocked.createBillingPortalSession.mockResolvedValue({ url: 'https://portal' })
  // Stub window.location so the checkout/portal redirects are observable without
  // jsdom's "navigation not implemented" noise. (window === globalThis here.)
  assignMock = vi.fn()
  vi.stubGlobal('location', { origin: 'http://localhost', assign: assignMock })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BillingPage — tabs', () => {
  it('renders the three billing tabs', async () => {
    renderAt('/billing')
    expect(screen.getByRole('tab', { name: 'Plans' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Invoices' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Payments' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Plans' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('switches to the Invoices tab on click', async () => {
    renderAt('/billing')
    fireEvent.click(screen.getByRole('tab', { name: 'Invoices' }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Invoices' })
      ).toBeInTheDocument()
    )
    expect(mocked.listInvoices).toHaveBeenCalled()
  })
})

describe('BillingPage — Plans tab', () => {
  it('renders a pricing card per plan after loading', async () => {
    renderAt('/billing')
    await waitFor(() =>
      expect(screen.getByRole('group', { name: /Basic plan/i })).toBeInTheDocument()
    )
    expect(screen.getByRole('group', { name: /Pro plan/i })).toBeInTheDocument()
    expect(screen.getByText('$9.00')).toBeInTheDocument()
    expect(screen.getByText('Unlimited workspaces')).toBeInTheDocument()
  })

  it('shows an empty state when there are no plans', async () => {
    mocked.listPlans.mockResolvedValue([])
    renderAt('/billing')
    await waitFor(() =>
      expect(
        screen.getByText(/no plans are available/i)
      ).toBeInTheDocument()
    )
  })

  it('shows an error alert when plans fail to load', async () => {
    mocked.listPlans.mockRejectedValue(new Error('boom'))
    renderAt('/billing')
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/not available/i)
    )
  })

  it('starts checkout and redirects when a plan CTA is clicked', async () => {
    renderAt('/billing')
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /subscribe/i }).length).toBe(2)
    )
    fireEvent.click(screen.getAllByRole('button', { name: /subscribe/i })[0])
    await waitFor(() =>
      expect(mocked.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'price_basic', organizationId: 'org-1' })
      )
    )
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('https://checkout')
    )
  })

  it('marks the current plan when it matches the subscription', async () => {
    mocked.getSubscription.mockResolvedValue({ planName: 'Pro', status: 'active' })
    renderAt('/billing')
    const proCard = await screen.findByRole('group', { name: /Pro plan/i })
    expect(within(proCard).getByText(/current plan/i)).toBeInTheDocument()
  })
})

describe('BillingPage — Invoices tab', () => {
  it('renders invoice rows', async () => {
    mocked.listInvoices.mockResolvedValue({
      invoices: [
        {
          id: 'in_1',
          number: 'FF-001',
          created: '2026-06-01T00:00:00.000Z',
          amountDue: 900,
          amountPaid: 900,
          currency: 'usd',
          status: 'paid',
          hostedInvoiceUrl: 'https://inv/1',
          invoicePdf: null,
        },
      ],
      nextCursor: null,
    })
    renderAt('/billing/invoices')
    await waitFor(() => expect(screen.getByText('FF-001')).toBeInTheDocument())
    expect(screen.getByText('$9.00')).toBeInTheDocument()
    expect(screen.getByText('paid')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view/i })).toHaveAttribute(
      'href',
      'https://inv/1'
    )
  })

  it('shows the empty state when there are no invoices', async () => {
    renderAt('/billing/invoices')
    await waitFor(() =>
      expect(screen.getByText(/no invoices yet/i)).toBeInTheDocument()
    )
  })

  it('loads more when a next cursor is present', async () => {
    mocked.listInvoices
      .mockResolvedValueOnce({
        invoices: [
          {
            id: 'in_1',
            number: 'FF-001',
            created: '2026-06-01T00:00:00.000Z',
            amountDue: 900,
            amountPaid: 900,
            currency: 'usd',
            status: 'paid',
            hostedInvoiceUrl: null,
            invoicePdf: null,
          },
        ],
        nextCursor: 'in_1',
      })
      .mockResolvedValueOnce({
        invoices: [
          {
            id: 'in_2',
            number: 'FF-002',
            created: '2026-05-01T00:00:00.000Z',
            amountDue: 900,
            amountPaid: 900,
            currency: 'usd',
            status: 'paid',
            hostedInvoiceUrl: null,
            invoicePdf: null,
          },
        ],
        nextCursor: null,
      })
    renderAt('/billing/invoices')
    await waitFor(() => expect(screen.getByText('FF-001')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() => expect(screen.getByText('FF-002')).toBeInTheDocument())
    expect(mocked.listInvoices).toHaveBeenLastCalledWith('org-1', {
      limit: 20,
      cursor: 'in_1',
    })
  })
})

describe('BillingPage — Payments tab', () => {
  it('opens the Stripe portal and redirects', async () => {
    renderAt('/billing/payments')
    const btn = await screen.findByRole('button', { name: /manage billing/i })
    fireEvent.click(btn)
    await waitFor(() =>
      expect(mocked.createBillingPortalSession).toHaveBeenCalledWith(
        'org-1',
        'http://localhost/billing/payments'
      )
    )
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('https://portal')
    )
  })
})
