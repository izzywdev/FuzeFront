import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PortalBrandingProvider } from '../context/PortalBrandingProvider'
import { BrandingBoundary } from './BrandingBoundary'
import type { PortalContextSource } from '../api/portalClient'

function axiosError(status: number, data?: unknown) {
  return { response: { status, data } }
}

function renderWithClient(client: PortalContextSource) {
  return render(
    <PortalBrandingProvider enabled client={client}>
      <BrandingBoundary>{ctx => <div data-testid="ready">{ctx.branding.name}</div>}</BrandingBoundary>
    </PortalBrandingProvider>
  )
}

describe('BrandingBoundary', () => {
  it('renders the no-flash loading skeleton before the request settles, with no FuzeFront text', () => {
    const client: PortalContextSource = { getPortalContext: vi.fn(() => new Promise(() => {})) }
    renderWithClient(client)
    const skeleton = document.querySelector('[data-state="loading"]')
    expect(skeleton).toBeVisible()
    expect(skeleton?.textContent ?? '').not.toContain('FuzeFront')
  })

  it('renders children(context) once ready', async () => {
    const client: PortalContextSource = {
      getPortalContext: vi.fn().mockResolvedValue({ slug: 'corpabc', branding: { name: 'CorpABC' } }),
    }
    renderWithClient(client)
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('CorpABC'))
  })

  it('renders the error state with a retry action on a generic failure', async () => {
    const client: PortalContextSource = {
      getPortalContext: vi.fn().mockRejectedValue(axiosError(500, { error: 'boom' })),
    }
    renderWithClient(client)
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeVisible())
    expect(screen.getByRole('button', { name: /try again/i })).toBeVisible()
  })

  it('renders the suspended notice on a 403, containing "unavailable"', async () => {
    const client: PortalContextSource = {
      getPortalContext: vi.fn().mockRejectedValue(axiosError(403, { error: 'PORTAL_SUSPENDED' })),
    }
    renderWithClient(client)
    await waitFor(() => expect(document.querySelector('[data-state="suspended"]')).toBeVisible())
    expect(document.querySelector('[data-state="suspended"]')?.textContent).toContain('unavailable')
  })
})
