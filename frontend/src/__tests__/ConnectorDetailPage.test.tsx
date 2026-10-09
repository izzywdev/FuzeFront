import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConnectorDetailPage from '../pages/ConnectorDetailPage'

vi.mock('../lib/accounts', () => ({ getActiveAuthToken: () => 'synthetic' }))

const connector = { id: 'openai', name: 'OpenAI', authentication: 'api-key', configured: true }
const ok = (data: unknown) => ({ ok: true, json: async () => data })
const failed = () => ({ ok: false, status: 502, json: async () => ({ error: 'Status service unavailable' }) })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(ok({ connectors: [connector] }))
    .mockResolvedValueOnce(failed())
    .mockResolvedValueOnce(ok({ connectors: [connector] }))
    .mockResolvedValueOnce(ok({ status: 'disconnected' })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('allows retrying an unavailable connection status before connecting', async () => {
  render(<MemoryRouter initialEntries={['/connectors/openai']}><Routes><Route path="/connectors/:connectorId" element={<ConnectorDetailPage />} /></Routes></MemoryRouter>)

  expect(await screen.findByText('Status unavailable')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Retry status' }))
  await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
  expect((screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('OpenAI API key'), { target: { value: 'test-key' } })
  expect((screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(false)
})

test('re-enables connection controls after saving an API key', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(ok({ connectors: [connector] }))
    .mockResolvedValueOnce(ok({ status: 'disconnected' }))
    .mockResolvedValueOnce(ok({}))
    .mockResolvedValueOnce(ok({ connectors: [connector] }))
    .mockResolvedValueOnce(ok({ status: 'connected' })))
  render(<MemoryRouter initialEntries={['/connectors/openai']}><Routes><Route path="/connectors/:connectorId" element={<ConnectorDetailPage />} /></Routes></MemoryRouter>)

  fireEvent.change(await screen.findByLabelText('OpenAI API key'), { target: { value: 'test-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }))

  const disconnect = await screen.findByRole('button', { name: 'Disconnect' })
  await waitFor(() => expect((disconnect as HTMLButtonElement).disabled).toBe(false))
})
