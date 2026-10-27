// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./App', () => ({
  App: ({
    getToken,
    getTenantId,
  }: {
    getToken?: () => string | null
    getTenantId?: () => string | null
  }) => (
    <output>
      token:{getToken?.() ?? 'none'};tenant:{getTenantId?.() ?? 'none'}
    </output>
  ),
}))

import FuzeQualityRemote from './remote'

describe('FuzeQuality federation identity contract', () => {
  it('forwards both host-owned account and tenant resolvers to the application', () => {
    render(
      <FuzeQualityRemote
        getToken={() => 'portal-token'}
        getTenantId={() => 'personal-tenant-1'}
      />,
    )

    expect(screen.getByText('token:portal-token;tenant:personal-tenant-1')).toBeTruthy()
  })
})
