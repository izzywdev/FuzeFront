import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConnectorsPage from '../pages/ConnectorsPage'

vi.mock('../lib/accounts', () => ({ getActiveAuthToken: () => 'synthetic' }))

const catalog = [
  { id: 'google-drive', name: 'Google Drive', description: 'Read files', authentication: 'oauth', configured: true },
  { id: 'openai', name: 'OpenAI', description: 'List models', authentication: 'api-key', configured: true },
]
const ok = (data: unknown) => ({ ok: true, json: async () => data })
const failed = () => ({ ok: false, status: 502, json: async () => ({ error: 'Status service unavailable' }) })
const renderPage = () => render(<MemoryRouter><ConnectorsPage /></MemoryRouter>)

beforeEach(() => window.history.replaceState({}, '', '/connectors'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

test('renders every catalog connector as a details link while statuses resolve independently', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/catalog')) return ok({ connectors: catalog })
    if (url.endsWith('/openai')) return ok({ status: 'disconnected' })
    return new Promise(() => {})
  }))
  renderPage()
  const drive = await screen.findByRole('link', { name: /Google Drive/i })
  expect(drive.getAttribute('href')).toBe('/connectors/google-drive')
  expect(screen.getByText('Loading connection status…')).toBeTruthy()
  expect(await screen.findByText('Not connected')).toBeTruthy()
})

test('keeps the catalog visible and allows a retry when a status request fails', async () => {
  let unavailable = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/catalog')) return ok({ connectors: catalog })
    return unavailable ? failed() : ok({ status: 'disconnected' })
  }))
  renderPage()
  expect((await screen.findAllByText('Status unavailable')).length).toBe(2)
  unavailable = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByText('Status unavailable')).toBeNull())
  expect(screen.getAllByText('Not connected').length).toBe(2)
})

test('a late status response cannot overwrite a newer catalog load', async () => {
  let resolveOld: (response: ReturnType<typeof ok>) => void = () => {}
  let retry = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/catalog')) return ok({ connectors: catalog })
    if (url.endsWith('/google-drive') && !retry) return new Promise<ReturnType<typeof ok>>(resolve => { resolveOld = resolve })
    if (url.endsWith('/openai') && !retry) return failed()
    return ok({ status: 'disconnected' })
  }))
  renderPage()
  await screen.findByRole('button', { name: 'Retry' })
  retry = true
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findAllByText('Not connected')
  await act(async () => resolveOld(ok({ status: 'connected', identity_email: 'stale@example.test' })))
  expect(screen.queryByText(/stale@example/i)).toBeNull()
})
