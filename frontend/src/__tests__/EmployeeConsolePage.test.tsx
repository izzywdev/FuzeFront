/**
 * EmployeeConsolePage.test.tsx — FF-EPIC-17-S9 cross-org explorer, rewired
 * (per PR #698 / @fuzefront/security-client 0.6.0) onto the two
 * server-authoritative reads: `GET /v1/security/employee/status` (the
 * AUTHORITATIVE `isEmployee` gate) and the cursor-paginated
 * `GET /v1/security/employee/orgs` (the ReBAC-authoritative org tree).
 *
 * Exercises the real wiring (fetch -> @fuzefront/identity-ui's
 * `createEmployeeClient`, resolved from source), mirroring
 * `MemberDirectoryPage.test.tsx`'s pattern: stub global `fetch`, let the
 * real HttpClient run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import EmployeeConsolePage from '../pages/EmployeeConsolePage'

const ROOT_ID = 'org_root'
const STATUS_URL = '/api/v1/security/employee/status'
const ORGS_URL = '/api/v1/security/employee/orgs'

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

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    statusText: status < 300 ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
  } as Response
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/staff']}>
      <Routes>
        <Route path="/staff" element={<EmployeeConsolePage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('<EmployeeConsolePage />', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    flagValue = false
    currentUser = { id: 'user-1', email: 'jae@example.com', roles: ['employee'] }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('flag gate', () => {
    it('flag OFF (default): renders no console chrome and never fetches', () => {
      flagValue = false
      renderPage()
      expect(screen.getByText(/isn.t available yet/i)).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('flag ON + Employee (server-confirmed)', () => {
    it('resolves status via getEmployeeStatus, then fetches the org tree via listEmployeeOrgs and renders the explorer', async () => {
      flagValue = true
      fetchMock.mockImplementation((url: string) => {
        if (url === STATUS_URL) {
          return Promise.resolve(mockResponse({ isEmployee: true, directOrgMemberships: [] }))
        }
        if (url.startsWith(ORGS_URL)) {
          return Promise.resolve(
            mockResponse({
              items: [
                { orgId: ROOT_ID, name: 'FuzeFront', parentOrgId: null, kind: 'root', depth: 0 },
                { orgId: 'org_acme', name: 'Acme Co', parentOrgId: ROOT_ID, kind: 'organization', depth: 1 },
              ],
              page: { nextCursor: null, hasMore: false },
            })
          )
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())
      expect(document.querySelector('[data-list="reachable-orgs"]')).toBeInTheDocument()
      expect(document.querySelector('[data-state="forbidden"]')).not.toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith(STATUS_URL, expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      }))
      expect(fetchMock).toHaveBeenCalledWith(`${ORGS_URL}?limit=100`, expect.anything())
    })

    it('page-walks the cursor to hasMore:false and assembles the full tree across pages', async () => {
      flagValue = true
      fetchMock.mockImplementation((url: string) => {
        if (url === STATUS_URL) {
          return Promise.resolve(mockResponse({ isEmployee: true, directOrgMemberships: [] }))
        }
        if (url === `${ORGS_URL}?limit=100`) {
          return Promise.resolve(
            mockResponse({
              items: [{ orgId: ROOT_ID, name: 'FuzeFront', parentOrgId: null, kind: 'root', depth: 0 }],
              page: { nextCursor: 'c1', hasMore: true },
            })
          )
        }
        if (url === `${ORGS_URL}?limit=100&cursor=c1`) {
          return Promise.resolve(
            mockResponse({
              items: [{ orgId: 'org_acme', name: 'Acme Co', parentOrgId: ROOT_ID, kind: 'organization', depth: 1 }],
              page: { nextCursor: null, hasMore: false },
            })
          )
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())
      expect(fetchMock).toHaveBeenCalledWith(`${ORGS_URL}?limit=100`, expect.anything())
      expect(fetchMock).toHaveBeenCalledWith(`${ORGS_URL}?limit=100&cursor=c1`, expect.anything())
    })

    it('the real empty state (only root reachable) renders empty, never an error', async () => {
      flagValue = true
      fetchMock.mockImplementation((url: string) => {
        if (url === STATUS_URL) {
          return Promise.resolve(mockResponse({ isEmployee: true, directOrgMemberships: [] }))
        }
        if (url.startsWith(ORGS_URL)) {
          return Promise.resolve(
            mockResponse({
              items: [{ orgId: ROOT_ID, name: 'FuzeFront', parentOrgId: null, kind: 'root', depth: 0 }],
              page: { nextCursor: null, hasMore: false },
            })
          )
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() => expect(document.querySelector('[data-state="empty"]')).toBeInTheDocument())
      expect(document.querySelector('[data-state="error"]')).not.toBeInTheDocument()
    })
  })

  describe('non-Employee, flag ON', () => {
    it('client hint AND server status both false: renders the fail-closed notice and never fetches the org tree', async () => {
      flagValue = true
      currentUser = { id: 'user-2', email: 'rando@example.com', roles: ['user'] }
      fetchMock.mockImplementation((url: string) => {
        if (url === STATUS_URL) {
          return Promise.resolve(mockResponse({ isEmployee: false, directOrgMemberships: [] }))
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() =>
        expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
      )
      expect(document.querySelector('[data-error-code="FORBIDDEN"]')).toBeInTheDocument()
      expect(screen.queryByText(/cross-org explorer/i)).not.toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/employee/orgs'), expect.anything())
    })

    it('the SERVER status is authoritative over a stale client-side "employee" role hint (fail-closed)', async () => {
      flagValue = true
      // roles carries the client-side hint marker, but the server disagrees.
      currentUser = { id: 'user-3', email: 'exemployee@example.com', roles: ['employee'] }
      fetchMock.mockImplementation((url: string) => {
        if (url === STATUS_URL) {
          return Promise.resolve(mockResponse({ isEmployee: false, directOrgMemberships: [] }))
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() =>
        expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
      )
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/employee/orgs'), expect.anything())
    })

    it('a 403 from the org-tree fetch mid-session (role revoked) fails closed to the forbidden notice', async () => {
      flagValue = true
      fetchMock.mockImplementation((url: string) => {
        if (url === STATUS_URL) {
          return Promise.resolve(mockResponse({ isEmployee: true, directOrgMemberships: [] }))
        }
        if (url.startsWith(ORGS_URL)) {
          return Promise.resolve(mockResponse({ error: 'nope', code: 'FORBIDDEN' }, 403))
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() =>
        expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
      )
    })
  })

  describe('error state', () => {
    it('flag ON + Employee: a failed org-tree fetch renders an error with retry', async () => {
      flagValue = true
      fetchMock.mockImplementation((url: string) => {
        if (url === STATUS_URL) {
          return Promise.resolve(mockResponse({ isEmployee: true, directOrgMemberships: [] }))
        }
        if (url.startsWith(ORGS_URL)) {
          return Promise.resolve(mockResponse({ error: 'boom' }, 500))
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    it('a status-resolution failure fails closed to the forbidden notice, even for a likely Employee (client hint true)', async () => {
      flagValue = true
      currentUser = { id: 'user-4', email: 'jae@example.com', roles: ['employee'] }
      fetchMock.mockImplementation((url: string) => {
        if (url === STATUS_URL) return Promise.reject(new Error('network'))
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() =>
        expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
      )
    })
  })
})
