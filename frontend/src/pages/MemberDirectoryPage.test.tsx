/**
 * MemberDirectoryPage.test.tsx — FF-EPIC-17-S5 root/portal member directory.
 *
 * Exercises the real wiring (fetch -> @fuzefront/identity-ui's
 * MemberDirectoryFlow, resolved from source) against the frozen
 * `GET /api/organizations/{id}/directory` contract, per
 * design/frames/member-directory/**.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MemberDirectoryPage from './MemberDirectoryPage'

vi.mock('../lib/accounts', () => ({
  getActiveAuthToken: () => 'tok-123',
}))

vi.mock('../services/api', () => ({
  getOrganizations: vi.fn().mockResolvedValue([{ id: 'org-1', name: 'FuzeFront' }]),
}))

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    statusText: status < 300 ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
  } as Response
}

function renderPage(orgId = 'org-1') {
  return render(
    <MemoryRouter initialEntries={[`/organizations/${orgId}/directory`]}>
      <Routes>
        <Route path="/organizations/:id/directory" element={<MemberDirectoryPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MemberDirectoryPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    // NOT vi.restoreAllMocks(): the module-mocked `getOrganizations` above is a
    // plain vi.fn() (no real implementation to "restore" to), so restoreAllMocks
    // wipes its .mockResolvedValue() back to undefined after the first test.
    vi.unstubAllGlobals()
  })

  it('fetches the first offset-paginated page on mount and renders members', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        items: [{ userId: 'usr_1', displayName: 'Ada Rowe', email: 'ada@ex.com', role: 'owner', isSelf: true }],
        page: 1,
        pageSize: 25,
        total: 1,
      })
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Ada Rowe')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/organizations/org-1/directory?limit=25&offset=0',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }) })
    )
  })

  it('renders the 403 forbidden panel IN PLACE — never a sign-in redirect', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ error: 'nope', code: 'FORBIDDEN' }, 403))
    renderPage()
    await waitFor(() => expect(document.querySelector('[data-http="403"]')).toBeInTheDocument())
    expect(document.querySelector('[data-error-code="FORBIDDEN"]')).toBeInTheDocument()
    expect(screen.queryByText('Ada Rowe')).not.toBeInTheDocument()
  })

  it('shows the error state with retry on a non-403 failure, and refetches on Retry', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ error: 'boom' }, 500))
    renderPage()
    const retry = await screen.findByRole('button', { name: /retry/i })
    fetchMock.mockResolvedValueOnce(
      mockResponse({ items: [], page: 1, pageSize: 25, total: 0 })
    )
    fireEvent.click(retry)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('resets to page 1 and issues a server-side search request when the query settles', async () => {
    fetchMock.mockResolvedValue(mockResponse({ items: [], page: 1, pageSize: 25, total: 0 }))
    renderPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fetchMock.mockClear()
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: 'ada' } })
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('query=ada'),
          expect.anything()
        ),
      { timeout: 1000 }
    )
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('offset=0')
  })
})
