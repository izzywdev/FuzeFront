import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConnectorsPage from '../pages/ConnectorsPage'

vi.mock('../lib/accounts', () => ({ getActiveAuthToken: () => 'synthetic' }))

beforeEach(() => {
  window.history.replaceState({}, '', '/connectors')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/catalog')) return { ok: true, json: async () => ({ connectors: [{ id: 'stripe', name: 'Stripe', description: 'Accept payments', authentication: 'api-key', configured: true }] }) }
    return { ok: false, status: 403, json: async () => ({ detail: 'denied' }) }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('OAuth pending redirect remains visible in the catalog when status is denied before approval', async () => {
  window.history.replaceState({}, '', '/connectors?authorization_pending=stripe')
  render(<MemoryRouter><ConnectorsPage /></MemoryRouter>)
  expect(await screen.findByText('Awaiting approval')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('Contact your administrator')
  expect(screen.queryByText(/^Connected/)).toBeNull()
})
