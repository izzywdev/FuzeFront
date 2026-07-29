import { describe, expect, it } from 'vitest'
import { normalizePortalContext, ROOT_FALLBACK_CONTEXT } from './normalize'

describe('normalizePortalContext', () => {
  it('normalizes the CorpABC fixture shape (portalId/slug/status/branding)', () => {
    const result = normalizePortalContext({
      portalId: 'prt_corpabc',
      slug: 'corpabc',
      status: 'active',
      branding: {
        name: 'CorpABC',
        logo: null,
        favicon: null,
        accent: '#2452e8',
        tagline: 'Your team, connected.',
      },
    })
    expect(result).toEqual({
      id: 'prt_corpabc',
      slug: 'corpabc',
      isRoot: false,
      branding: {
        name: 'CorpABC',
        logo: null,
        favicon: null,
        accent: '#2452e8',
        tagline: 'Your team, connected.',
      },
    })
  })

  it('resolves isRoot from the documented root slug (fuzefront) when isRoot is absent', () => {
    const result = normalizePortalContext({
      portalId: 'prt_root',
      slug: 'fuzefront',
      status: 'active',
      branding: { name: 'FuzeFront', logo: null, favicon: null, accent: null, tagline: null },
    })
    expect(result.isRoot).toBe(true)
    expect(result.branding.name).toBe('FuzeFront')
  })

  it('prefers an explicit isRoot flag over the slug heuristic (frozen PortalContext schema)', () => {
    const result = normalizePortalContext({
      id: 'prt_northwind',
      slug: 'northwind',
      isRoot: false,
      branding: { name: 'Northwind' },
    })
    expect(result.isRoot).toBe(false)
    expect(result.id).toBe('prt_northwind')
  })

  it('normalizes garbage/empty input to the root-fallback context (fail-closed unknown-host)', () => {
    expect(normalizePortalContext(undefined)).toEqual(ROOT_FALLBACK_CONTEXT)
    expect(normalizePortalContext(null)).toEqual(ROOT_FALLBACK_CONTEXT)
    expect(normalizePortalContext({})).toEqual(ROOT_FALLBACK_CONTEXT)
    expect(normalizePortalContext({ error: 'not_found' })).toEqual(ROOT_FALLBACK_CONTEXT)
  })

  it('falls back to the slug when branding.name is missing', () => {
    const result = normalizePortalContext({ slug: 'northwind', branding: {} })
    expect(result.branding.name).toBe('northwind')
  })

  it('coerces non-string branding fields to null rather than throwing', () => {
    const result = normalizePortalContext({
      slug: 'corpabc',
      branding: { name: 'CorpABC', logo: 42, accent: {}, tagline: [] },
    })
    expect(result.branding.logo).toBeNull()
    expect(result.branding.accent).toBeNull()
    expect(result.branding.tagline).toBeNull()
  })
})
