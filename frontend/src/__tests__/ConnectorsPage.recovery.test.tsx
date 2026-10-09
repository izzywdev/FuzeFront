import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConnectorsPage from '../pages/ConnectorsPage'

vi.mock('../lib/accounts', () => ({ getActiveAuthToken: () => 'synthetic' }))

const catalog = [
  { id: 'google-drive', name: 'Google Drive', authentication: 'oauth', configured: true },
  { id: 'openai', name: 'OpenAI', authentication: 'api-key', configured: true },
]
const ok = (data: unknown) => ({ ok: true, json: async () => data })
const failed = () => ({ ok: false, status: 502, json: async () => ({ error: 'Status service unavailable' }) })
const card = (name: string) => within(screen.getByRole('heading', { name, level: 2 }).closest('section')!)

beforeEach(() => window.history.replaceState({}, '', '/connectors'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

test('catalog cards appear while Gmail and another provider status are still pending', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/catalog')) return ok({ connectors: catalog })
    if (url.endsWith('/openai')) return ok({ status: 'disconnected' })
    return new Promise(() => {})
  }))
  render(<ConnectorsPage />)
  expect(await screen.findByRole('heading', { name: 'Google Drive' })).toBeTruthy()
  expect(await card('OpenAI').findByText('Not connected')).toBeTruthy()
  expect(card('Google Drive').getByText('Loading connection status…')).toBeTruthy()
  expect(card('Google Drive').getByRole('button', { name: 'Connect' }).hasAttribute('disabled')).toBe(true)
  expect(card('Google Gmail').getByText('Loading connection status…')).toBeTruthy()
})

test('failed metadata stays visible as unavailable and disables connection controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/catalog') ? ok({ connectors: catalog }) : failed()))
  render(<ConnectorsPage />)
  expect(await card('Google Gmail').findByText('Status unavailable')).toBeTruthy()
  expect(await screen.findByRole('heading', { name: 'Google Drive' })).toBeTruthy()
  await waitFor(() => expect(card('Google Drive').getByText('Status unavailable')).toBeTruthy())
  expect(card('Google Gmail').queryByText('Not connected')).toBeNull()
  expect(card('Google Drive').getByRole('button', { name: 'Connect' }).hasAttribute('disabled')).toBe(true)
  expect(card('OpenAI').getByRole('button', { name: 'Save key' }).hasAttribute('disabled')).toBe(true)
})

test('retry recovers a failed catalog without changing credentials or grants', async () => {
  let unavailable = true
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.method || 'GET').toBe('GET')
    if (url.endsWith('/catalog')) return unavailable ? failed() : ok({ connectors: catalog })
    return ok({ provider: 'google-gmail', status: 'disconnected' })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<ConnectorsPage />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  unavailable = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('heading', { name: 'Google Drive' })).toBeTruthy()
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/credential') || url.endsWith('/connect'))).toBe(false)
})

test('a timed-out status becomes unavailable while the catalog remains visible', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/catalog')) return ok({ connectors: catalog })
    return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  }))
  render(<ConnectorsPage />)
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('heading', { name: 'Google Drive' })).toBeTruthy()
  await act(async () => { vi.advanceTimersByTime(10_000) })
  expect(card('Google Drive').getByText('Status unavailable')).toBeTruthy()
  expect(card('Google Gmail').getByText('Status unavailable')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
})

test('a late response from the previous load cannot overwrite a retried status', async () => {
  let resolveOld: (response: ReturnType<typeof ok>) => void = () => {}
  let retried = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/catalog')) return ok({ connectors: catalog })
    if (url.endsWith('/google-drive') && !retried) return new Promise<ReturnType<typeof ok>>(resolve => { resolveOld = resolve })
    if (url.endsWith('/openai') && !retried) return failed()
    return ok({ status: 'disconnected' })
  }))
  render(<ConnectorsPage />)
  const retry = await screen.findByRole('button', { name: 'Retry' })
  retried = true
  fireEvent.click(retry)
  expect(await card('Google Drive').findByText('Not connected')).toBeTruthy()
  await act(async () => resolveOld(ok({ status: 'connected', identity_email: 'stale@example.test' })))
  expect(card('Google Drive').getByText('Not connected')).toBeTruthy()
  expect(card('Google Drive').queryByText(/^Connected/)).toBeNull()
})
