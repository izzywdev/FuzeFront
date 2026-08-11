import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MyOrganizationsPage from '../pages/MyOrganizationsPage'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const apiMocks = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
  createOrganization: vi.fn(),
}))
vi.mock('../services/api', () => apiMocks)

vi.mock('../lib/shared', () => ({
  useAppContext: () => ({ dispatch: vi.fn() }),
  useOrganizations: () => ({ organizations: [], setActiveOrganization: vi.fn() }),
  ROOT_ORG_ID: '00000000-0000-0000-0000-000000000010',
}))

vi.mock('../components/PermissionGate', () => ({
  usePermissions: () => ({ hasPermission: vi.fn().mockResolvedValue(true) }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <MyOrganizationsPage />
    </MemoryRouter>
  )
}

describe('MyOrganizationsPage', () => {
  it('AC3: a user who belongs only to root sees root with MEMBER, not an empty/broken list', async () => {
    apiMocks.getOrganizations.mockResolvedValue([
      { id: ROOT_ID, name: 'FuzeFront', user_role: 'member', parentId: null },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('FuzeFront')).toBeInTheDocument())
    expect(screen.getByText('FuzeFront').closest('[data-role="member"]')).toBeInTheDocument()
  })

  it('renders every direct-membership org with its sub-org tree', async () => {
    apiMocks.getOrganizations.mockResolvedValue([
      { id: ROOT_ID, name: 'FuzeFront', user_role: 'member', parentId: null },
      { id: 'org_acme', name: 'Acme Co', user_role: 'viewer', parentId: null },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())
  })

  it('navigates to /organizations/:id when an org card is opened', async () => {
    apiMocks.getOrganizations.mockResolvedValue([
      { id: ROOT_ID, name: 'FuzeFront', user_role: 'member', parentId: null },
      { id: 'org_acme', name: 'Acme Co', user_role: 'viewer', parentId: null },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())
    const card = screen.getByText('Acme Co').closest('[data-org="org_acme"]') as HTMLElement
    const openBtn = card.querySelector('button')!
    openBtn.click()
    expect(navigateMock).toHaveBeenCalledWith('/organizations/org_acme')
  })

  it('renders an error state with retry on fetch failure', async () => {
    apiMocks.getOrganizations.mockRejectedValue(new Error('network'))
    renderPage()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
