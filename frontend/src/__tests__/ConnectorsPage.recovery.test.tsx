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
  expect(screen.getAllByText('Loading connection status…').length).toBeGreaterThan(0)
  expect(await screen.findByText('Not connected')).toBeTruthy()
})

test('keeps the catalog visible and allows a retry when a status request fails', async () => {
  let unavailable = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/catalog')) return ok({ connectors: catalog })
    return unavailable ? failed() : ok({ status: 'disconnected' })
  }))
  renderPage()
  expect((await screen.findAllByText('Status unavailable')).length).toBe(3)
  unavailable = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByText('Status unavailable')).toBeNull())
  expect(screen.getAllByText('Not connected').length).toBe(3)
})

test('does not start a competing catalog load while connection statuses are resolving', async () => {
  let resolveStatus: (response: ReturnType<typeof ok>) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/catalog')) return ok({ connectors: catalog })
    if (url.endsWith('/google-drive')) return new Promise<ReturnType<typeof ok>>(resolve => { resolveStatus = resolve })
    if (url.endsWith('/google-gmail')) return failed()
    return ok({ status: 'disconnected' })
  }))
  renderPage()
  const retry = await screen.findByRole('button', { name: 'Retry' })
  expect((retry as HTMLButtonElement).disabled).toBe(true)
  await act(async () => resolveStatus(ok({ status: 'disconnected' })))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false))
})
