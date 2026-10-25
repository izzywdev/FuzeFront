// /admin "Edit app": registry-managed apps save through the contracted
// updateApp (PUT /api/v1/app-registry/apps/{slug}) with the edited fields merged
// into the fetched manifest; legacy manifest-less rows keep the legacy route.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const registry = vi.hoisted(() => ({
  getApp: vi.fn(),
  updateApp: vi.fn(),
}))
const api = vi.hoisted(() => ({
  fetchApps: vi.fn(),
  updateApp: vi.fn(),
  createApp: vi.fn(),
  updateAppStatus: vi.fn(),
  deleteApp: vi.fn(),
}))
const ctx = vi.hoisted(() => ({ apps: [] as any[] }))

vi.mock('../platform/appRegistry', () => ({
  useAppRegistry: () => ({ client: registry }),
}))
vi.mock('../platform/featureFlags', () => ({ useFlag: () => false }))
vi.mock('../services/api', () => api)
vi.mock('../lib/shared', () => ({
  useAppContext: () => ({ state: { apps: ctx.apps }, dispatch: vi.fn() }),
}))

import AdminPage, { mergeFormIntoManifest } from './AdminPage'

const manifest = {
  manifestVersion: '1',
  slug: 'clock',
  name: 'Clock',
  menuLabel: 'Clock',
  mode: 'portal',
  integration: {
    type: 'module-federation',
    remoteEntry: '/apps/clock/assets/remoteEntry.js',
    scope: 'clock',
    module: './ClockApp',
  },
  scopeLevel: 'both',
  visibility: 'public',
}
const registryRow = {
  id: 'app-1',
  slug: 'clock',
  name: 'Clock',
  url: '/apps/clock/',
  isActive: true,
  integrationType: 'module-federation',
  remoteUrl: '/apps/clock/assets/remoteEntry.js',
  scope: 'clock',
  module: './ClockApp',
  description: '',
}
const legacyRow = {
  id: 'app-2',
  slug: null,
  name: 'Legacy',
  url: 'https://legacy.example.com',
  isActive: true,
  integrationType: 'iframe',
}

async function editAndSave(newName: string) {
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>
  )
  fireEvent.click(screen.getAllByText(/Edit/)[0])
  const input = (await screen.findByLabelText(/App Name/)) as HTMLInputElement
  fireEvent.change(input, { target: { value: newName } })
  fireEvent.click(screen.getByText('Update App'))
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchApps.mockResolvedValue([])
})

describe('mergeFormIntoManifest', () => {
  const seeded = {
    name: 'Clock',
    url: '/apps/clock/',
    iconUrl: '',
    integrationType: 'module-federation' as const,
    remoteUrl: '/apps/clock/assets/remoteEntry.js',
    scope: 'clock',
    module: './ClockApp',
    description: '',
  }
  it('writes only changed fields and preserves the rest of the manifest', () => {
    const out = mergeFormIntoManifest(
      manifest as any,
      { ...seeded, name: 'Clock 2', iconUrl: 'https://x/i.png' },
      seeded
    )
    expect(out.name).toBe('Clock 2')
    expect(out.icon).toEqual({ kind: 'url', value: 'https://x/i.png' })
    expect(out.integration).toEqual(manifest.integration)
    expect((out as any).scopeLevel).toBe('both')
    expect((out as any).visibility).toBe('public')
    expect(out.slug).toBe('clock')
  })
  it('drops optional fields cleared by the admin', () => {
    const withDesc = {
      ...manifest,
      description: 'd',
      icon: { kind: 'url', value: 'https://x/i.png' },
    }
    const out = mergeFormIntoManifest(
      withDesc as any,
      { ...seeded, description: '', iconUrl: '' },
      { ...seeded, description: 'd', iconUrl: 'https://x/i.png' }
    )
    expect(out.description).toBeUndefined()
    expect(out.icon).toBeUndefined()
  })
})

describe('AdminPage edit', () => {
  it('registry app: GET manifest, merge, PUT via updateApp(slug, manifest)', async () => {
    ctx.apps = [registryRow]
    registry.getApp.mockResolvedValue({ slug: 'clock', manifest })
    registry.updateApp.mockResolvedValue({})
    await editAndSave('Clock Renamed')
    await waitFor(() => expect(registry.updateApp).toHaveBeenCalledTimes(1))
    expect(registry.getApp).toHaveBeenCalledWith('clock')
    const [slug, sent] = registry.updateApp.mock.calls[0]
    expect(slug).toBe('clock')
    expect(sent.name).toBe('Clock Renamed')
    expect(sent.integration).toEqual(manifest.integration)
    expect(api.updateApp).not.toHaveBeenCalled()
  })

  it.each([
    [400, /Invalid app data/],
    [403, /permission/],
    [404, /not found/],
    [500, /server error/],
  ])('registry app: surfaces a %i error', async (status, msg) => {
    ctx.apps = [registryRow]
    registry.getApp.mockResolvedValue({ slug: 'clock', manifest })
    registry.updateApp.mockRejectedValue({ response: { status, data: {} } })
    await editAndSave('X')
    await waitFor(() => expect(registry.updateApp).toHaveBeenCalled())
    expect(await screen.findByText(msg)).toBeTruthy()
  })

  it('legacy manifest-less row keeps the legacy route', async () => {
    ctx.apps = [legacyRow]
    api.updateApp.mockResolvedValue({})
    await editAndSave('Legacy 2')
    await waitFor(() => expect(api.updateApp).toHaveBeenCalledTimes(1))
    expect(api.updateApp.mock.calls[0][0]).toBe('app-2')
    expect(registry.updateApp).not.toHaveBeenCalled()
  })
})
