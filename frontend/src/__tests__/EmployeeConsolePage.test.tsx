import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import EmployeeConsolePage from '../pages/EmployeeConsolePage'

const ROOT_ID = '00000000-0000-0000-0000-000000000010'

// `useFlag` is mocked per-test (both states are exercised — feature-flags
// skill's "test BOTH states" rule) rather than going through the real
// fetch-backed FeatureFlagProvider.
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

const apiMocks = vi.hoisted(() => ({ getOrganizations: vi.fn() }))
vi.mock('../services/api', () => apiMocks)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/staff']}>
      <Routes>
        <Route path="/staff" element={<EmployeeConsolePage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  flagValue = false
  currentUser = { id: 'user-1', email: 'jae@example.com', roles: ['employee'] }
})

describe('<EmployeeConsolePage /> — flag gate', () => {
  it('flag OFF (default): renders no console chrome and never fetches', () => {
    flagValue = false
    renderPage()
    expect(screen.getByText(/isn.t available yet/i)).toBeInTheDocument()
    expect(apiMocks.getOrganizations).not.toHaveBeenCalled()
  })

  it('flag ON + Employee: fetches the org tree and renders the explorer', async () => {
    flagValue = true
    apiMocks.getOrganizations.mockResolvedValue([
      { id: ROOT_ID, name: 'FuzeFront', parentId: null, user_role: 'member' },
      { id: 'org_acme', name: 'Acme Co', parentId: null, user_role: null },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument())
    expect(document.querySelector('[data-list="reachable-orgs"]')).toBeInTheDocument()
    expect(document.querySelector('[data-state="forbidden"]')).not.toBeInTheDocument()
  })
})

describe('<EmployeeConsolePage /> — non-Employee, flag ON', () => {
  it('renders the fail-closed notice and never fetches cross-org data', async () => {
    flagValue = true
    currentUser = { id: 'user-2', email: 'rando@example.com', roles: ['user'] }
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-state="forbidden"][data-http="403"]')).toBeInTheDocument()
    )
    expect(apiMocks.getOrganizations).not.toHaveBeenCalled()
    expect(screen.queryByText(/cross-org explorer/i)).not.toBeInTheDocument()
  })
})

describe('<EmployeeConsolePage /> — error state', () => {
  it('flag ON + Employee: a failed fetch renders an error with retry', async () => {
    flagValue = true
    apiMocks.getOrganizations.mockRejectedValue(new Error('network'))
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
