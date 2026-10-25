// /admin "Edit app": registry-managed apps save through the contracted
// updateApp (PUT /api/v1/app-registry/apps/{slug}) via ONE type-driven
// form<->manifest mapping; legacy manifest-less rows keep the legacy route.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const registry = vi.hoisted(() => ({
  getApp: vi.fn(),
  updateApp: vi.fn(),
}))
const refresh = vi.hoisted(() => vi.fn())
const api = vi.hoisted(() => ({
  fetchApps: vi.fn(),
  updateApp: vi.fn(),
  createApp: vi.fn(),
  updateAppStatus: vi.fn(),
  deleteApp: vi.fn(),
}))
const ctx = vi.hoisted(() => ({ apps: [] as any[] }))

vi.mock('../platform/appRegistry', () => ({
  useAppRegistry: () => ({ client: registry, refresh }),
}))
vi.mock('../platform/featureFlags', () => ({ useFlag: () => false }))
vi.mock('../services/api', () => api)
vi.mock('../lib/shared', () => ({
  useAppContext: () => ({ state: { apps: ctx.apps }, dispatch: vi.fn() }),
}))

import AdminPage, {
  buildManifestFromForm,
  seedFormFromManifest,
} from './AdminPage'

const base = {
  manifestVersion: '1',
  slug: 'clock',
  name: 'Clock',
  menuLabel: 'Clock',
  mode: 'portal',
  scopeLevel: 'both',
  visibility: 'public',
}
const mf = {
  ...base,
  integration: {
    type: 'module-federation',
    remoteEntry: '/apps/clock/assets/remoteEntry.js',
    scope: 'clock',
    module: './ClockApp',
  },
} as any
const iframe = {
  ...base,
  integration: { type: 'iframe', url: '/apps/x/' },
} as any
const wc = {
  ...base,
  integration: { type: 'web-component', url: '/apps/w/w.js', scope: 'my-w' },
} as any
const spa = {
  ...base,
  integration: { type: 'spa', url: '/apps/s/' },
} as any

const row = { id: 'app-1', slug: 'clock', name: 'Clock', url: '', isActive: true, integrationType: 'module-federation' }
const legacyRow = {
  id: 'app-2',
  slug: null,
  name: 'Legacy',
  url: 'https://legacy.example.com',
  isActive: true,
  integrationType: 'iframe',
}

async function openEdit(manifest: any) {
  ctx.apps = [{ ...row, slug: manifest.slug }]
  registry.getApp.mockResolvedValue({ slug: manifest.slug, manifest })
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>
  )
  fireEvent.click(screen.getAllByText(/Edit/)[0])
  return (await screen.findByLabelText(/App Name/)) as HTMLInputElement
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchApps.mockResolvedValue([])
  refresh.mockResolvedValue(undefined)
})

describe('seed/build mapping per integration type', () => {
  it.each([
    ['module-federation', mf],
    ['iframe', iframe],
    ['web-component', wc],
    ['spa', spa],
  ])('%s round-trips losslessly', (_t, m) => {
    const { manifest, errors } = buildManifestFromForm(m, seedFormFromManifest(m))
    expect(errors).toEqual([])
    expect(manifest.integration).toEqual(m.integration)
    expect((manifest as any).scopeLevel).toBe('both')
  })

  it('web-component: Script URL is written to integration.url, not remoteEntry', () => {
    const form = { ...seedFormFromManifest(wc), remoteUrl: '/apps/w/new.js' }
    const { manifest } = buildManifestFromForm(wc, form)
    expect(manifest.integration).toEqual({
      type: 'web-component',
      url: '/apps/w/new.js',
      scope: 'my-w',
    })
  })

  it('type switch MF -> iframe populates url and drops MF-only fields', () => {
    const form = { ...seedFormFromManifest(mf), integrationType: 'iframe' as const, url: '/apps/clock/' }
    const { manifest, errors } = buildManifestFromForm(mf, form)
    expect(errors).toEqual([])
    expect(manifest.integration).toEqual({ type: 'iframe', url: '/apps/clock/' })
  })

  it('type switch MF -> iframe without a URL fails client-side validation', () => {
    const form = { ...seedFormFromManifest(mf), integrationType: 'iframe' as const }
    expect(buildManifestFromForm(mf, form).errors).toContain('App URL is required')
  })

  it('type switch iframe -> MF requires remoteEntry/scope/module', () => {
    const form = { ...seedFormFromManifest(iframe), integrationType: 'module-federation' as const }
    const { errors } = buildManifestFromForm(iframe, form)
    expect(errors).toEqual(
      expect.arrayContaining(['Remote URL is required', 'Scope is required', 'Module is required'])
    )
  })

  it('web-component requires a component name and script URL', () => {
    const form = { ...seedFormFromManifest(wc), scope: '', remoteUrl: '', url: '' }
    expect(buildManifestFromForm(wc, form).errors).toEqual(
      expect.arrayContaining(['Script URL is required', 'Component Name is required'])
    )
  })

  it('clears optional description/icon', () => {
    const withOpt = { ...mf, description: 'd', icon: { kind: 'url', value: 'https://x/i.png' } }
    const { manifest } = buildManifestFromForm(withOpt, {
      ...seedFormFromManifest(withOpt),
      description: '',
      iconUrl: '',
    })
    expect(manifest.description).toBeUndefined()
    expect(manifest.icon).toBeUndefined()
  })
})

describe('AdminPage edit', () => {
  it('registry app: seeds from manifest, PUTs merged manifest, refreshes provider', async () => {
    const input = await openEdit(mf)
    fireEvent.change(input, { target: { value: 'Clock Renamed' } })
    fireEvent.click(screen.getByText('Update App'))
    await waitFor(() => expect(registry.updateApp).toHaveBeenCalledTimes(1))
    const [slug, sent] = registry.updateApp.mock.calls[0]
    expect(slug).toBe('clock')
    expect(sent.name).toBe('Clock Renamed')
    expect(sent.integration).toEqual(mf.integration)
    expect(api.updateApp).not.toHaveBeenCalled()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('does not refresh the provider when the PUT fails', async () => {
    registry.updateApp.mockRejectedValue({ response: { status: 400, data: {} } })
    const input = await openEdit(mf)
    fireEvent.change(input, { target: { value: 'X' } })
    fireEvent.click(screen.getByText('Update App'))
    await screen.findByText(/Invalid app data/)
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    [400, /Invalid app data/],
    [403, /permission/],
    [404, /not found/],
    [500, /server error/],
  ])('surfaces a %i error', async (status, msg) => {
    registry.updateApp.mockRejectedValue({ response: { status, data: {} } })
    const input = await openEdit(mf)
    fireEvent.change(input, { target: { value: 'X' } })
    fireEvent.click(screen.getByText('Update App'))
    expect(await screen.findByText(msg)).toBeTruthy()
  })

  it('legacy manifest-less row keeps the legacy route', async () => {
    ctx.apps = [legacyRow]
    api.updateApp.mockResolvedValue({})
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    )
    fireEvent.click(screen.getAllByText(/Edit/)[0])
    const input = (await screen.findByLabelText(/App Name/)) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Legacy 2' } })
    fireEvent.click(screen.getByText('Update App'))
    await waitFor(() => expect(api.updateApp).toHaveBeenCalledTimes(1))
    expect(api.updateApp.mock.calls[0][0]).toBe('app-2')
    expect(registry.updateApp).not.toHaveBeenCalled()
    expect(registry.getApp).not.toHaveBeenCalled()
  })
})
