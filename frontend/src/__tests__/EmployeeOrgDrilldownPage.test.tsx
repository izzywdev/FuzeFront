import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import EmployeeOrgDrilldownPage from '../pages/EmployeeOrgDrilldownPage'

let flagValue = false
vi.mock('../platform/featureFlags', () => ({
  useFlag: (_key: string, _fallback: boolean) => flagValue,
}))

let currentUser: { id: string; email: string; roles: string[] } | null = null
vi.mock('../lib/shared', async () => {
  const actual = await vi.importActual<typeof import('../lib/shared')>('../lib/shared')
  return {
    ...actual,
    useCurrentUser: () => ({ user: currentUser, currentUser, isAuthenticated: !!currentUser }),
  }
})

const apiMocks = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  default: { get: vi.fn() },
}))
vi.mock('../services/api', () => apiMocks)

function renderPage(orgId = 'org_acme') {
  return render(
    <MemoryRouter initialEntries={[`/staff/orgs/${orgId}`]}>
      <Routes>
        <Route path="/staff/orgs/:id" element={<EmployeeOrgDrilldownPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  flagValue = false
  currentUser = { id: 'user-1', email: 'jae@example.com', roles: ['employee'] }
  apiMocks.getOrganization.mockResolvedValue({ id: 'org_acme', name: 'Acme Co' })
  apiMocks.default.get.mockResolvedValue({
    data: { items: [{ membershipId: 'u_9001', role: 'owner', user: { firstName: 'Rae', lastName: 'Park', email: 'rae@acme.example' } }], page: { nextCursor: null, hasMore: false } },
  })
})

describe('<EmployeeOrgDrilldownPage /> — flag gate', () => {
  it('flag OFF: renders no drilldown chrome and never fetches', () => {
    flagValue = false
    renderPage()
    expect(screen.getByText(/isn.t available yet/i)).toBeInTheDocument()
    expect(apiMocks.getOrganization).not.toHaveBeenCalled()
  })
})

describe('<EmployeeOrgDrilldownPage /> — Employee, flag ON', () => {
  it('resolves the org header via the single-org GET and renders its own direct members, tolerating the {items} envelope', async () => {
    flagValue = true
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())
    expect(apiMocks.getOrganization).toHaveBeenCalledWith('org_acme')
    expect(screen.getByText('Rae Park')).toBeInTheDocument()
    expect(document.querySelector('[data-panel="inherited-access"]')).toBeInTheDocument()
  })
})

describe('<EmployeeOrgDrilldownPage /> — non-Employee, flag ON', () => {
  it('renders the fail-closed notice and never fetches org or member data', async () => {
    flagValue = true
    currentUser = { id: 'user-2', email: 'rando@example.com', roles: ['user'] }
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
    )
    expect(apiMocks.getOrganization).not.toHaveBeenCalled()
    expect(apiMocks.default.get).not.toHaveBeenCalled()
  })
})
