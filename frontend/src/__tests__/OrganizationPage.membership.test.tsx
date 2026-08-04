import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import OrganizationPage from '../pages/OrganizationPage'

// Mock the api module: importing it for real fires an axios connectivity probe
// at module load that never settles under jsdom (same reason as the other
// OrganizationSelector/org tests).
const apiMocks = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
  getOrganizationMembers: vi.fn(),
  updateOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
}))
vi.mock('../services/api', () => apiMocks)

const currentUser = vi.hoisted(() => ({
  user: { id: 'u1', email: 'a@b.c' },
  isAuthenticated: true,
}))
vi.mock('../lib/shared', () => ({ useCurrentUser: () => currentUser }))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

vi.mock('../components/PermissionGate', () => ({
  PermissionGate: ({ children }: any) => children,
}))

vi.mock('../components/OrganizationSettings', () => ({
  OrganizationSettings: () => <div data-testid="org-settings" />,
}))

// IdentityPage owns the Members/Permissions/Invitations/Tokens sub-tabs. A
// non-member must NOT reach it (every call would 403), so its presence/absence
// is the signal under test.
vi.mock('@fuzefront/identity-ui', () => ({
  IdentityPage: () => <div data-testid="identity-page" />,
}))

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
  render(<OrganizationPage />)
  // Wait past the loading skeleton — the org name appears once loaded.
  await screen.findByRole('heading', { name: /organization management/i })
  return org
}

describe('OrganizationPage — membership / role visibility', () => {
  it('shows a "not a member" state on the Members tab when user_role is null', async () => {
    await renderWithOrg({ ...baseOrg, user_role: null })

    fireEvent.click(screen.getByRole('button', { name: /members/i }))

    await waitFor(() =>
      expect(
        screen.getByText(/not a member of this organization/i)
      ).toBeInTheDocument()
    )
    // IdentityPage must not render for a non-member — no 403-prone calls fire.
    expect(screen.queryByTestId('identity-page')).not.toBeInTheDocument()
  })

  it('renders IdentityPage on the Members tab for an actual member', async () => {
    await renderWithOrg({ ...baseOrg, type: 'organization', user_role: 'admin' })

    fireEvent.click(screen.getByRole('button', { name: /members/i }))

    await waitFor(() =>
      expect(screen.getByTestId('identity-page')).toBeInTheDocument()
    )
    expect(
      screen.queryByText(/not a member of this organization/i)
    ).not.toBeInTheDocument()
  })

  it('shows the caller real role in the header badge for a member', async () => {
    // Member → role badge reflects the real role (never the old fake VIEWER).
    await renderWithOrg({ ...baseOrg, type: 'organization', user_role: 'admin' })
    expect(screen.getByText(/ADMIN/)).toBeInTheDocument()
    expect(screen.queryByText(/GUEST/)).not.toBeInTheDocument()
  })

  it('shows a GUEST badge (never a fake VIEWER) when user_role is null', async () => {
    await renderWithOrg({ ...baseOrg, user_role: null })
    expect(screen.getByText(/GUEST/)).toBeInTheDocument()
    expect(screen.queryByText(/VIEWER/)).not.toBeInTheDocument()
  })
})
