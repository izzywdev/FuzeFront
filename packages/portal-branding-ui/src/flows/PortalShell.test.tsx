import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const getPortalContext = vi.fn().mockResolvedValue({
  portalId: 'prt_corpabc',
  slug: 'corpabc',
  status: 'active',
  branding: { name: 'CorpABC', logo: null, favicon: null, accent: '#2452e8', tagline: 'Your team, connected.' },
})

vi.mock('../api/portalClient', () => ({
  createPortalClient: () => ({ getPortalContext }),
}))

// Imported AFTER the mock so PortalBrandingProvider picks up the fake client.
const { PortalShell } = await import('./PortalShell')

describe('PortalShell', () => {
  it('mounts topbar / side-panel / app-grid regions, branded [data-portal="corpabc"]', async () => {
    render(<PortalShell />)

    await waitFor(() => expect(screen.getByText('CorpABC')).toBeVisible())

    expect(document.querySelector('[data-region="topbar"]')).toBeVisible()
    expect(document.querySelector('[data-region="side-panel"]')).toBeVisible()
    expect(document.querySelector('[data-region="app-grid"]')).toBeVisible()
    expect(document.querySelector('[data-portal="corpabc"]')).toBeInTheDocument()
    expect(document.querySelector('[data-portal-badge]')?.textContent).toContain('corpabc')
  })
})
