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

const { PortalLoginFlow } = await import('./PortalLoginFlow')

describe('PortalLoginFlow', () => {
  it('mounts the branded [data-whitelabel="true"] login surface once context resolves', async () => {
    render(<PortalLoginFlow />)

    await waitFor(() => expect(document.querySelector('[data-whitelabel="true"]')).toBeInTheDocument())
    expect(document.querySelector('[data-form="login"]')).toBeVisible()
    expect(screen.getByRole('button', { name: /sign in to corpabc/i })).toBeVisible()
    expect(document.querySelector('[data-whitelabel="true"]')?.textContent).not.toContain('FuzeFront')
  })
})
