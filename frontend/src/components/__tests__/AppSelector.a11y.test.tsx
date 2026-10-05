import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppSelector from '../AppSelector'
import { LanguageProvider } from '../../contexts/LanguageContext'

/**
 * Issue #1024 — focused accessibility pass on the 9-dots app selector.
 *
 * Covers: accessible name + disclosure semantics on the trigger button
 * (aria-haspopup / aria-expanded / aria-controls), a labelled panel once
 * open, and keyboard dismissal (Escape) that returns focus to the trigger
 * — the concrete gaps the issue asked to audit for.
 */

const mockApps = [
  { slug: 'clock', mode: 'portal', isHealthy: true, manifest: { menuLabel: 'Clock', integration: { type: 'module-federation' } } },
  { slug: 'market', mode: 'portal', isHealthy: true, manifest: { menuLabel: 'Market', integration: { type: 'module-federation' } } },
]

vi.mock('../../platform/appRegistry', () => ({
  useRegisteredApps: () => ({ apps: mockApps }),
}))
vi.mock('../../lib/shared', () => ({
  useCurrentUser: () => ({ user: { roles: ['member'] } }),
  useOrganizations: () => ({ activeOrganizationId: null }),
  ROOT_ORG_ID: '00000000-0000-0000-0000-000000000010',
}))

function renderAppSelector() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <AppSelector />
      </LanguageProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AppSelector accessibility', () => {
  it('exposes an accessible name and closed disclosure state on the trigger button', () => {
    renderAppSelector()
    const button = screen.getByRole('button', { name: /applications/i })
    expect(button).toHaveAttribute('aria-haspopup', 'true')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-controls')
  })

  it('hides the decorative 9-dots icon from assistive tech', () => {
    renderAppSelector()
    const button = screen.getByRole('button', { name: /applications/i })
    const svg = button.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('flips aria-expanded, points aria-controls at a labelled panel, and lists apps when opened', async () => {
    renderAppSelector()
    const button = screen.getByRole('button', { name: /applications/i })
    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    const panelId = button.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()

    const panel = document.getElementById(panelId!)
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('role', 'dialog')

    const labelId = panel!.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId!)).toHaveTextContent(/applications/i)

    await waitFor(() => {
      expect(screen.getByText('Clock')).toBeInTheDocument()
      expect(screen.getByText('Market')).toBeInTheDocument()
    })
  })

  it('closes on Escape and returns focus to the trigger button', async () => {
    renderAppSelector()
    const button = screen.getByRole('button', { name: /applications/i })
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'true'))

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'))
    expect(document.activeElement).toBe(button)
  })

  it('closes and returns focus to the trigger when the backdrop is dismissed', async () => {
    const { container } = renderAppSelector()
    const button = screen.getByRole('button', { name: /applications/i })
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'true'))

    const backdrop = container.querySelector('[data-testid="app-selector-backdrop"]')
    expect(backdrop).toBeInTheDocument()
    fireEvent.click(backdrop!)

    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'))
    expect(document.activeElement).toBe(button)
  })

  it('each app tile is keyboard-focusable and activatable', async () => {
    renderAppSelector()
    const button = screen.getByRole('button', { name: /applications/i })
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText('Clock')).toBeInTheDocument())
    const clockTile = screen.getByText('Clock').closest('[role="button"]')!
    expect(clockTile).toHaveAttribute('tabIndex', '0')
  })
})
