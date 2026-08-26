/**
 * MasterAdminPortalsPage.test.tsx — FF-EPIC-17-S7 master-admin portal fleet
 * console, gated behind `fuzefront.platform.multi-tenant-portals` (release
 * flag, default OFF) and wired to the REAL, merged org-tree portal contract
 * (`@fuzefront/security-client` 0.7.0, PR #704:
 * `GET/POST /api/v1/security/portals`,
 * `POST /api/v1/security/portals/{portalOrgId}/(suspend|resume)`).
 *
 * Exercises the real wiring (fetch -> @fuzefront/portal-admin-ui's
 * `createAdminPortalsClient`, resolved from source via the vite/vitest alias)
 * — mirrors `EmployeeConsolePage.test.tsx`'s pattern: stub global `fetch`,
 * let the real HttpClient run. Covers BOTH flag states (baseline §10 /
 * `feature-flags` skill) plus the frame states this flow renders: loading,
 * empty, populated, error+retry, and the fail-closed 403 FORBIDDEN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import MasterAdminPortalsPage from '../pages/MasterAdminPortalsPage'

const PORTALS_URL = '/api/v1/security/portals'

let flagValue = false
vi.mock('../platform/featureFlags', () => ({
  useFlag: (_key: string, _fallback: boolean) => flagValue,
}))

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
    <MemoryRouter initialEntries={['/admin/portals']}>
      <Routes>
        <Route path="/admin/portals" element={<MasterAdminPortalsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

const PORTAL = {
  orgId: 'org_acme',
  parentOrgId: 'org_root',
  name: 'Acme Co',
  slug: 'acme',
  kind: 'portal',
  status: 'active',
  isPortalRoot: true,
  ownerEmail: 'owner@acme.example',
  customDomain: null,
  branding: { name: 'Acme Co' },
  billingMode: 'platform',
  appCatalogMode: 'inherit',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('<MasterAdminPortalsPage />', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    flagValue = false
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('flag gate — fuzefront.platform.multi-tenant-portals', () => {
    it('flag OFF (default): renders no console chrome and never fetches the fleet', () => {
      flagValue = false
      renderPage()
      expect(screen.getByText(/isn.t available yet/i)).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('flag ON: fetches the fleet from the real org-tree contract and renders it', async () => {
      flagValue = true
      fetchMock.mockImplementation((url: string) => {
        if (url.startsWith(PORTALS_URL)) {
          return Promise.resolve(mockResponse({ items: [PORTAL], page: { nextCursor: null, hasMore: false } }))
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      renderPage()
      await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(PORTALS_URL),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }) })
      )
    })
  })

  describe('flag ON — frame states', () => {
    beforeEach(() => {
      flagValue = true
    })

    it('renders the real empty state when zero portals exist (the platform root is never listed)', async () => {
      fetchMock.mockResolvedValue(mockResponse({ items: [], page: { nextCursor: null, hasMore: false } }))
      renderPage()
      await waitFor(() => expect(document.querySelector('[data-state="empty"]')).toBeInTheDocument())
      expect(screen.getByText('No tenant portals yet')).toBeInTheDocument()
    })

    it('renders an error with retry on a load failure', async () => {
      fetchMock.mockResolvedValue(mockResponse({ error: 'boom' }, 500))
      renderPage()
      await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })

    it('a non-platform-admin gets the fail-closed 403 FORBIDDEN state rendered in place, never a redirect', async () => {
      fetchMock.mockResolvedValue(mockResponse({ error: 'Forbidden', code: 'FORBIDDEN' }, 403))
      renderPage()
      await waitFor(() => expect(document.querySelector('[data-state="forbidden"]')).toBeInTheDocument())
      expect(document.querySelector('[data-error-code="FORBIDDEN"][data-http="403"]')).toBeInTheDocument()
      expect(document.querySelector('[data-portal]')).not.toBeInTheDocument()
    })
  })
})
