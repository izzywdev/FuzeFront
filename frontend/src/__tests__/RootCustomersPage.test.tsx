import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RootCustomersPage from '../pages/RootCustomersPage'
import { LanguageProvider } from '../contexts/LanguageContext'
import * as api from '../services/api'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/root/customers']}>
      <LanguageProvider>
        <RootCustomersPage />
      </LanguageProvider>
    </MemoryRouter>
  )
}

const org = (over: Partial<api.Organization>): api.Organization => ({
  id: 'org_root',
  name: 'FuzeFront',
  type: 'platform',
  ...over,
})

describe('RootCustomersPage (/root/customers, flag fuzefront.identity.invite-v2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lets the ROOT owner invite a customer: POSTs to the platform org with memberType customer', async () => {
    vi.spyOn(api, 'getOrganizations').mockResolvedValue([
      org({ id: 'org_other', type: 'organization', user_role: 'owner' }),
      org({ user_role: 'owner' }),
    ])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      text: async () => JSON.stringify({ id: 'inv_1' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    const email = await screen.findByLabelText(/personal email/i)
    expect(screen.getByRole('group', { name: 'Member type' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(email, { target: { value: 'pat.rivera@gmail.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send customer invitation' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/organizations/org_root/invitations')
    expect(JSON.parse(init.body)).toEqual({
      invitee: { kind: 'external', channel: 'email', email: 'pat.rivera@gmail.com' },
      role: 'viewer',
      memberType: 'customer',
    })
  })

  it('renders the in-place forbidden state for a non-owner (admin) — no form', async () => {
    vi.spyOn(api, 'getOrganizations').mockResolvedValue([org({ user_role: 'admin' })])
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).toBeInTheDocument())
    expect(document.querySelector('[data-panel="root-customer-invite"]')).not.toBeInTheDocument()
  })

  it('treats a visible-but-not-a-member root (user_role null) as non-owner, never owner', async () => {
    vi.spyOn(api, 'getOrganizations').mockResolvedValue([org({ user_role: null })])
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).toBeInTheDocument())
  })

  it('shows an error with retry when the org list fails', async () => {
    const spy = vi
      .spyOn(api, 'getOrganizations')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([org({ user_role: 'owner' })])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByLabelText(/personal email/i)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
