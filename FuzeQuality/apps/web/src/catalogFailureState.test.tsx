// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Portfolio } from '@fuzequality/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { api, CatalogApiError } from './api'

const emptyPortfolio: Portfolio = {
  repositories: [],
  operations: [],
  surfaces: [],
  tests: [],
  expectations: [],
  findings: [],
  diagnostics: [],
  requirements: [],
  flows: [],
  suggestions: [],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as Window & { __FUZEFRONT__?: unknown }).__FUZEFRONT__
})

describe('catalog failure recovery', () => {
  it('stops the loading state after a terminal tenant failure and retries explicitly', async () => {
    const portfolio = vi.spyOn(api, 'portfolio')
      .mockRejectedValueOnce(new CatalogApiError(
        'Active tenant membership required',
        'TENANT_FORBIDDEN',
        403,
      ))
      .mockResolvedValueOnce(emptyPortfolio)
    vi.spyOn(api, 'platformOrganizations').mockRejectedValue(new Error('not a platform administrator'))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Active tenant membership required')
    expect(screen.queryByText('Loading evidence graph…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(portfolio).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('does not render a stale response after the portal switches tenants', async () => {
    let publishContext: ((context: { user: { id: string }; tenantId: string }) => void) | undefined
    ;(window as Window & { __FUZEFRONT__?: unknown }).__FUZEFRONT__ = {
      getContext: () => ({ user: { id: 'user-1' }, tenantId: 'tenant-1' }),
      subscribe: (listener: typeof publishContext) => {
        publishContext = listener
        return () => undefined
      },
    }
    let rejectFirst: ((reason: Error) => void) | undefined
    const firstPortfolio = new Promise<Portfolio>((_resolve, reject) => {
      rejectFirst = reject
    })
    const portfolio = vi.spyOn(api, 'portfolio')
      .mockReturnValueOnce(firstPortfolio)
      .mockResolvedValueOnce(emptyPortfolio)
    vi.spyOn(api, 'platformOrganizations').mockRejectedValue(new Error('not a platform administrator'))

    render(<App />)
    await waitFor(() => expect(portfolio).toHaveBeenCalledOnce())

    publishContext?.({ user: { id: 'user-1' }, tenantId: 'tenant-2' })
    await waitFor(() => expect(portfolio).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Loading evidence graph…')).not.toBeInTheDocument())

    rejectFirst?.(new Error('stale tenant failure'))
    await Promise.resolve()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
