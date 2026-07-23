import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { AppRegistryClient } from '@fuzefront/app-registry-client'
import { AppRegistryProvider, useAppRegistry } from '../appRegistry'

/**
 * Regression coverage for the prod boot-freeze fix: the app-registry client
 * must NOT be queried while there is no authenticated session (e.g. on
 * /login). Calling it pre-auth only ever produced a 10s axios timeout and a
 * `Failed to load registered apps` console error, and was implicated in the
 * renderer main-thread stall observed live on app.fuzefront.com.
 */

vi.mock('@fuzefront/app-registry-client', () => {
  const listApps = vi.fn().mockResolvedValue({ apps: [] })
  return {
    AppRegistryClient: vi.fn().mockImplementation(() => ({ listApps })),
  }
})

function Probe() {
  const { loading, apps } = useAppRegistry()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="count">{apps.length}</span>
    </div>
  )
}

describe('AppRegistryProvider auth gating', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT call listApps when enabled=false (pre-auth / /login)', async () => {
    render(
      <AppRegistryProvider enabled={false}>
        <Probe />
      </AppRegistryProvider>,
    )

    // Give any stray microtask a chance to run before asserting the negative.
    await act(async () => {
      await Promise.resolve()
    })

    const instance = (AppRegistryClient as unknown as vi.Mock).mock.results[0]
      ?.value
    expect(instance.listApps).not.toHaveBeenCalled()
  })

  it('resolves loading=false immediately when disabled, without hanging', async () => {
    const { getByTestId } = render(
      <AppRegistryProvider enabled={false}>
        <Probe />
      </AppRegistryProvider>,
    )
    await waitFor(() => expect(getByTestId('loading').textContent).toBe('false'))
    expect(getByTestId('count').textContent).toBe('0')
  })

  it('DOES call listApps when enabled (default), post-auth', async () => {
    render(
      <AppRegistryProvider>
        <Probe />
      </AppRegistryProvider>,
    )

    await waitFor(() => {
      const instance = (AppRegistryClient as unknown as vi.Mock).mock.results[0]
        ?.value
      expect(instance.listApps).toHaveBeenCalledWith({ status: 'activated' })
    })
  })
})
