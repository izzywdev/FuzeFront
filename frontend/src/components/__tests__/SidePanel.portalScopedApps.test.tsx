import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SidePanel from '../SidePanel'

/**
 * FF-EPIC-12-S4 — the "Apps" menu section renders exactly whatever
 * `useRegisteredApps()` hands it. The scoping decision (curated
 * tenant-portal catalog vs. the full root catalog vs. flag-off/pre-epic
 * global list vs. a fail-closed empty set) is made entirely server-side —
 * see `appRegistry.portalScoping.test.tsx` for that contract. This suite
 * proves the MENU itself degrades correctly for each shape of that response:
 * only the given apps are shown, nothing extra leaks in, and an empty list
 * never breaks or hangs the menu.
 */

let mockApps: Array<{ slug: string; manifest: { icon?: unknown; menuLabel: string } }> = []

vi.mock('../../lib/shared', () => ({
  useCurrentUser: () => ({ user: { roles: ['admin'] } }),
  useAppContext: () => ({ state: { menuItems: [] } }),
}))
vi.mock('../../platform/appRegistry', () => ({
  useRegisteredApps: () => ({ apps: mockApps }),
}))
vi.mock('../../platform/useActiveApp', () => ({
  useActiveApp: () => null,
}))
vi.mock('@fuzefront/i18n', () => ({
  useT: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}))
vi.mock('../../platform/featureFlags', () => ({
  useFlag: (_key: string, fallback: boolean) => fallback,
}))

function renderSidePanel() {
  return render(
    <MemoryRouter>
      <SidePanel />
    </MemoryRouter>,
  )
}

const tenantApp = { slug: 'tenant-crm', manifest: { menuLabel: 'CRM' } }
const rootApps = [
  { slug: 'clock', manifest: { menuLabel: 'Clock' } },
  { slug: 'market', manifest: { menuLabel: 'Market' } },
  // NOT "Billing" — the portal menu's own static section also renders a
  // "Billing" item (see SidePanel.tsx), so reusing that label here would
  // make the assertion ambiguous between the two, unrelated sections.
  { slug: 'timesheets', manifest: { menuLabel: 'Timesheets' } },
]
const globalApp = { slug: 'public-directory', manifest: { menuLabel: 'Directory' } }

describe('<SidePanel /> — portal-scoped Apps section (FF-EPIC-12-S4)', () => {
  afterEach(() => {
    mockApps = []
  })

  it('tenant-portal session (scoped): shows ONLY the curated app(s), nothing else', () => {
    mockApps = [tenantApp]
    renderSidePanel()

    expect(screen.getByText('Apps')).toBeInTheDocument()
    expect(screen.getByText('CRM')).toBeInTheDocument()
    expect(screen.queryByText('Clock')).not.toBeInTheDocument()
    expect(screen.queryByText('Directory')).not.toBeInTheDocument()
  })

  it('root-portal session: shows the FULL catalog', () => {
    mockApps = rootApps
    renderSidePanel()

    expect(screen.getByText('Apps')).toBeInTheDocument()
    expect(screen.getByText('Clock')).toBeInTheDocument()
    expect(screen.getByText('Market')).toBeInTheDocument()
    expect(screen.getByText('Timesheets')).toBeInTheDocument()
  })

  it('flag OFF / pre-epic session: unchanged — the global list renders exactly as before', () => {
    mockApps = [globalApp]
    renderSidePanel()

    expect(screen.getByText('Apps')).toBeInTheDocument()
    expect(screen.getByText('Directory')).toBeInTheDocument()
  })

  it('empty / denied scoped list: the Apps section is gracefully omitted — no crash, no console error, the rest of the menu still renders', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockApps = []

    renderSidePanel()

    // No "Apps" heading at all — a clean empty affordance, not a broken/hung
    // section with a header and no rows.
    expect(screen.queryByText('Apps')).not.toBeInTheDocument()
    // The rest of the portal menu is unaffected.
    expect(screen.getByText('Applications')).toBeInTheDocument()
    expect(errorSpy).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
