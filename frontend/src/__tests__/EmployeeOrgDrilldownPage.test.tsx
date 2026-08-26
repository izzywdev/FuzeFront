/**
 * EmployeeOrgDrilldownPage.test.tsx — FF-EPIC-17-S9, rewired (PR #698 /
 * @fuzefront/security-client 0.6.0) onto the server-authoritative
 * `GET /v1/security/employee/status` gate. The single-org header and its
 * member list stay on the pre-existing, already-ReBAC-gated
 * `GET /api/organizations/:id` / `/:id/members` routes (unchanged) — see
 * `EmployeeConsolePage.test.tsx` for the cross-org tree rewiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import EmployeeOrgDrilldownPage from '../pages/EmployeeOrgDrilldownPage'

const STATUS_URL = '/api/v1/security/employee/status'

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

vi.mock('../lib/accounts', () => ({
  getActiveAuthToken: () => 'tok-123',
}))

const apiMocks = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  default: { get: vi.fn() },
}))
vi.mock('../services/api', () => apiMocks)

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    statusText: status < 300 ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
  } as Response
}

function renderPage(orgId = 'org_acme') {
  return render(
    <MemoryRouter initialEntries={[`/staff/orgs/${orgId}`]}>
      <Routes>
        <Route path="/staff/orgs/:id" element={<EmployeeOrgDrilldownPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('<EmployeeOrgDrilldownPage />', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn().mockResolvedValue(mockResponse({ isEmployee: true, directOrgMemberships: [] }))
    vi.stubGlobal('fetch', fetchMock)
    flagValue = false
    currentUser = { id: 'user-1', email: 'jae@example.com', roles: ['employee'] }
    apiMocks.getOrganization.mockResolvedValue({ id: 'org_acme', name: 'Acme Co' })
    apiMocks.default.get.mockResolvedValue({
      data: {
        items: [{ membershipId: 'u_9001', role: 'owner', user: { firstName: 'Rae', lastName: 'Park', email: 'rae@acme.example' } }],
        page: { nextCursor: null, hasMore: false },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('flag gate', () => {
    it('flag OFF: renders no drilldown chrome and never fetches', () => {
      flagValue = false
      renderPage()
      expect(screen.getByText(/isn.t available yet/i)).toBeInTheDocument()
      expect(apiMocks.getOrganization).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('Employee, flag ON (server-confirmed)', () => {
    it('resolves isEmployee via getEmployeeStatus, then resolves the org header via the single-org GET and renders its own direct members, tolerating the {items} envelope', async () => {
      flagValue = true
      renderPage()
      await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())
      expect(fetchMock).toHaveBeenCalledWith(STATUS_URL, expect.anything())
      expect(apiMocks.getOrganization).toHaveBeenCalledWith('org_acme')
      expect(screen.getByText('Rae Park')).toBeInTheDocument()
      expect(document.querySelector('[data-panel="inherited-access"]')).toBeInTheDocument()
    })
  })

  describe('non-Employee, flag ON', () => {
    it('server status false: renders the fail-closed notice and never fetches org or member data', async () => {
      flagValue = true
      currentUser = { id: 'user-2', email: 'rando@example.com', roles: ['user'] }
      fetchMock.mockResolvedValue(mockResponse({ isEmployee: false, directOrgMemberships: [] }))
      renderPage()
      await waitFor(() =>
        expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
      )
      expect(apiMocks.getOrganization).not.toHaveBeenCalled()
      expect(apiMocks.default.get).not.toHaveBeenCalled()
    })

    it('the server status overrides a stale client-side "employee" role hint (fail-closed)', async () => {
      flagValue = true
      currentUser = { id: 'user-3', email: 'exemployee@example.com', roles: ['employee'] }
      fetchMock.mockResolvedValue(mockResponse({ isEmployee: false, directOrgMemberships: [] }))
      renderPage()
      await waitFor(() =>
        expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
      )
      expect(apiMocks.getOrganization).not.toHaveBeenCalled()
    })
  })
})
