import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PortalThemeScope } from './PortalThemeScope'
import type { NormalizedPortalContext } from '../types'

const CORPABC: NormalizedPortalContext = {
  id: 'prt_corpabc',
  slug: 'corpabc',
  isRoot: false,
  branding: { name: 'CorpABC', logo: null, favicon: null, accent: '#2452e8', tagline: null },
}

const ROOT: NormalizedPortalContext = {
  id: 'prt_root',
  slug: 'fuzefront',
  isRoot: true,
  branding: { name: 'FuzeFront', logo: null, favicon: null, accent: null, tagline: null },
}

describe('PortalThemeScope', () => {
  it('applies data-portal="corpabc" and the accent CSS var override for a tenant portal', () => {
    render(
      <PortalThemeScope context={CORPABC}>
        <span data-testid="child">child</span>
      </PortalThemeScope>
    )
    const scope = screen.getByTestId('child').closest('[data-portal]')
    expect(scope).toHaveAttribute('data-portal', 'corpabc')
    expect((scope as HTMLElement).style.getPropertyValue('--accent-color')).toBe('#2452e8')
  })

  it('applies the literal data-portal="root" (not the fuzefront slug) for the root portal', () => {
    render(
      <PortalThemeScope context={ROOT}>
        <span data-testid="child">child</span>
      </PortalThemeScope>
    )
    const scope = screen.getByTestId('child').closest('[data-portal]')
    expect(scope).toHaveAttribute('data-portal', 'root')
  })

  it('renders children with no wrapper/override when context is null', () => {
    render(
      <PortalThemeScope context={null}>
        <span data-testid="child">child</span>
      </PortalThemeScope>
    )
    expect(screen.getByTestId('child').closest('[data-portal]')).toBeNull()
  })
})
