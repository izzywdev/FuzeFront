import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PortalBrandingProvider, usePortalContext } from './PortalBrandingProvider'
import type { PortalContextSource } from '../api/portalClient'

function axiosError(status: number, data?: unknown) {
  return { response: { status, data } }
}

function Probe() {
  const { status, context, retry } = usePortalContext()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="name">{context?.branding.name ?? ''}</span>
      <span data-testid="portal">{context ? (context.isRoot ? 'root' : context.slug) : ''}</span>
      <button onClick={retry}>retry</button>
    </div>
  )
}

describe('PortalBrandingProvider', () => {
  it('stays disabled and issues no request when enabled=false', async () => {
    const getPortalContext = vi.fn()
    render(
      <PortalBrandingProvider enabled={false} client={{ getPortalContext }}>
        <Probe />
      </PortalBrandingProvider>
    )
    expect(screen.getByTestId('status')).toHaveTextContent('disabled')
    expect(getPortalContext).not.toHaveBeenCalled()
  })

  it('resolves 200 -> ready with the normalized context', async () => {
    const client: PortalContextSource = {
      getPortalContext: vi.fn().mockResolvedValue({
        portalId: 'prt_corpabc',
        slug: 'corpabc',
        branding: { name: 'CorpABC', accent: '#2452e8' },
      }),
    }
    render(
      <PortalBrandingProvider enabled client={client}>
        <Probe />
      </PortalBrandingProvider>
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('name')).toHaveTextContent('CorpABC')
    expect(screen.getByTestId('portal')).toHaveTextContent('corpabc')
  })

  it('403 -> suspended, with no context', async () => {
    const client: PortalContextSource = {
      getPortalContext: vi.fn().mockRejectedValue(axiosError(403, { error: 'PORTAL_SUSPENDED' })),
    }
    render(
      <PortalBrandingProvider enabled client={client}>
        <Probe />
      </PortalBrandingProvider>
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('suspended'))
    expect(screen.getByTestId('name')).toHaveTextContent('')
  })

  it('404 -> ready with the root-fallback context (unknown host, fail-closed)', async () => {
    const client: PortalContextSource = {
      getPortalContext: vi
        .fn()
        .mockRejectedValue(
          axiosError(404, { portalId: 'prt_root', slug: 'fuzefront', branding: { name: 'FuzeFront' } })
        ),
    }
    render(
      <PortalBrandingProvider enabled client={client}>
        <Probe />
      </PortalBrandingProvider>
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('name')).toHaveTextContent('FuzeFront')
    expect(screen.getByTestId('portal')).toHaveTextContent('root')
  })

  it('500 -> error, and retry() re-issues the request', async () => {
    const getPortalContext = vi
      .fn()
      .mockRejectedValueOnce(axiosError(500, { error: 'boom' }))
      .mockResolvedValueOnce({ slug: 'corpabc', branding: { name: 'CorpABC' } })
    render(
      <PortalBrandingProvider enabled client={{ getPortalContext }}>
        <Probe />
      </PortalBrandingProvider>
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
    expect(getPortalContext).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'retry' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(getPortalContext).toHaveBeenCalledTimes(2)
  })

  it('a network failure with no response (no status) also resolves to error', async () => {
    const client: PortalContextSource = {
      getPortalContext: vi.fn().mockRejectedValue(new Error('Network Error')),
    }
    render(
      <PortalBrandingProvider enabled client={client}>
        <Probe />
      </PortalBrandingProvider>
    )
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
  })
})
