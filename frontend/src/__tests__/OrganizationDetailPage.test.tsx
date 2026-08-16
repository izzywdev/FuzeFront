/**
 * OrganizationDetailPage — /organizations/:id (FF-EPIC-17-S4).
 *
 * Mirrors the retired OrganizationPage.membership.test.tsx assertions: the
 * access badge shows the caller's REAL user_role (MEMBER, never a fake
 * VIEWER; a genuine non-member still sees the honest fallback, not a
 * fabricated GUEST-that-looks-authorized), and IdentityPage never mounts for
 * a non-member (every members/roles/tokens call would 403).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import OrganizationDetailPage from '../pages/OrganizationDetailPage'

const apiMocks = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
  getOrganizationMembers: vi.fn(),
  updateOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
}))
vi.mock('../services/api', () => apiMocks)

vi.mock('../lib/shared', () => ({
  useCurrentUser: () => ({ user: { id: 'u1', email: 'a@b.c' }, isAuthenticated: true }),
}))

vi.mock('../components/PermissionGate', () => ({
  PermissionGate: ({ children }: any) => children,
}))

vi.mock('../components/OrganizationSettings', () => ({
  OrganizationSettings: () => <div data-testid="org-settings" />,
}))

vi.mock('@fuzefront/identity-ui', async () => {
  const actual = await vi.importActual<typeof import('@fuzefront/identity-ui')>('@fuzefront/identity-ui')
  return { ...actual, IdentityPage: () => <div data-testid="identity-page" /> }
})

const baseOrg = {
  id: 'org-1',
  name: 'FuzeFront',
  slug: 'fuzefront',
  type: 'platform' as const,
  description: 'Platform org',
  owner_id: 'someone-else',
  is_active: true,
  settings: {},
  metadata: {},
  created_at: new Date('2024-01-01').toISOString(),
  updated_at: new Date('2024-01-02').toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.getOrganizationMembers.mockResolvedValue([])
})

async function renderWithOrg(org: any) {
  apiMocks.getOrganizations.mockResolvedValue([org])
  render(
    <MemoryRouter initialEntries={[`/organizations/${org.id}`]}>
      <Routes>
        <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
  await screen.findByRole('heading', { name: /fuzefront/i })
  return org
}

describe('OrganizationDetailPage — membership / role visibility', () => {
  it('shows a "not a member" state on the Members tab when user_role is null', async () => {
    await renderWithOrg({ ...baseOrg, user_role: null })
    fireEvent.click(screen.getByRole('button', { name: /members/i }))
    await waitFor(() =>
      expect(screen.getByText(/not a member of this organization/i)).toBeInTheDocument()
    )
    expect(screen.queryByTestId('identity-page')).not.toBeInTheDocument()
  })

  it('renders IdentityPage on the Members tab for an actual member', async () => {
    await renderWithOrg({ ...baseOrg, type: 'organization', user_role: 'admin' })
    fireEvent.click(screen.getByRole('button', { name: /members/i }))
    await waitFor(() => expect(screen.getByTestId('identity-page')).toBeInTheDocument())
    expect(screen.queryByText(/not a member of this organization/i)).not.toBeInTheDocument()
  })

  it('shows the caller real role in the header badge for a member', async () => {
    await renderWithOrg({ ...baseOrg, type: 'organization', user_role: 'admin' })
    expect(screen.getByText(/admin/i)).toBeInTheDocument()
    expect(screen.queryByText(/guest/i)).not.toBeInTheDocument()
  })

  it('root shows MEMBER, never GUEST, once user_role="member" (FF-EPIC-17-S1/S2)', async () => {
    await renderWithOrg({
      ...baseOrg,
      id: '00000000-0000-0000-0000-000000000010',
      user_role: 'member',
    })
    expect(screen.getByText(/^member$/i)).toBeInTheDocument()
    expect(screen.queryByText(/guest/i)).not.toBeInTheDocument()
  })

  it('shows a distinct Guest fallback (never a fabricated role) when user_role is null', async () => {
    await renderWithOrg({ ...baseOrg, user_role: null })
    expect(screen.getByText(/guest/i)).toBeInTheDocument()
  })
})
