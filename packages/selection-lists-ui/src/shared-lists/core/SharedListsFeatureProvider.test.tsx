import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  SHARED_LISTS_FLAG_KEY,
  SharedListsFeatureProvider,
  useSharedLists,
  type SharedListsFeatureProviderProps,
} from './SharedListsFeatureProvider'

function render(props?: Omit<SharedListsFeatureProviderProps, 'children'>) {
  const wrapper = ({ children }: { children?: ReactNode }) => (
    <SharedListsFeatureProvider {...props}>
      {children}
    </SharedListsFeatureProvider>
  )
  return renderHook(() => useSharedLists(), { wrapper })
}

describe('flag state (default OFF, fail-closed)', () => {
  it('a tree with NO provider is OFF — the 4.0.0 host is untouched, nothing throws', () => {
    const { result } = renderHook(() => useSharedLists())
    expect(result.current).toEqual({ enabled: false, isPlatformOrg: false })
  })

  it('a provider with no props is OFF', () => {
    expect(render().result.current).toEqual({
      enabled: false,
      isPlatformOrg: false,
    })
  })

  it('flag OFF is OFF', () => {
    expect(render({ sharedLists: false }).result.current.enabled).toBe(false)
  })

  it('flag ON is ON', () => {
    expect(render({ sharedLists: true }).result.current.enabled).toBe(true)
  })

  it.each([['true'], [1], ['on'], [{}], [null], [undefined]])(
    'only the boolean true turns it on: %j stays OFF',
    value => {
      const { result } = render({ sharedLists: value as unknown as boolean })
      expect(result.current.enabled).toBe(false)
    }
  )

  it('follows the flag when the host flips it (a flag that settles after first paint)', () => {
    let on = false
    const wrapper = ({ children }: { children?: ReactNode }) => (
      <SharedListsFeatureProvider sharedLists={on}>
        {children}
      </SharedListsFeatureProvider>
    )
    const { result, rerender } = renderHook(() => useSharedLists(), { wrapper })
    expect(result.current.enabled).toBe(false)
    on = true
    rerender()
    expect(result.current.enabled).toBe(true)
    on = false
    rerender()
    expect(result.current.enabled).toBe(false)
  })
})

describe('isPlatformOrg', () => {
  it('is carried only while the flag is ON', () => {
    expect(
      render({ sharedLists: true, isPlatformOrg: true }).result.current
    ).toEqual({
      enabled: true,
      isPlatformOrg: true,
    })
    expect(render({ sharedLists: true }).result.current.isPlatformOrg).toBe(
      false
    )
  })

  it('is forced false with the flag OFF, so the platform option can never appear', () => {
    expect(
      render({ sharedLists: false, isPlatformOrg: true }).result.current
    ).toEqual({
      enabled: false,
      isPlatformOrg: false,
    })
  })

  it('is false for anything but the boolean true', () => {
    expect(
      render({ sharedLists: true, isPlatformOrg: 'yes' as unknown as boolean })
        .result.current.isPlatformOrg
    ).toBe(false)
  })
})

describe('active organization (id + display name)', () => {
  it('carries the id and name while the flag is ON', () => {
    const value = render({
      sharedLists: true,
      organizationId: 'org_globex',
      organizationName: 'Globex Freight',
    }).result.current
    expect(value.organizationId).toBe('org_globex')
    expect(value.organizationName).toBe('Globex Freight')
  })

  it('is absent when the host passes nothing, an empty name or a non-string', () => {
    const value = render({
      sharedLists: true,
      organizationId: 7 as unknown as string,
      organizationName: '',
    }).result.current
    expect(value.organizationId).toBeUndefined()
    expect(value.organizationName).toBeUndefined()
  })

  it('is never exposed while the flag is OFF', () => {
    const value = render({
      sharedLists: false,
      organizationId: 'org_globex',
      organizationName: 'Globex Freight',
    }).result.current
    expect(value.organizationId).toBeUndefined()
    expect(value.organizationName).toBeUndefined()
  })
})

describe('context identity', () => {
  it('keeps one stable value while the inputs are unchanged', () => {
    const { result, rerender } = render({
      sharedLists: true,
      isPlatformOrg: true,
    })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('the innermost provider wins', () => {
    const wrapper = ({ children }: { children?: ReactNode }) => (
      <SharedListsFeatureProvider sharedLists>
        <SharedListsFeatureProvider sharedLists={false}>
          {children}
        </SharedListsFeatureProvider>
      </SharedListsFeatureProvider>
    )
    const { result } = renderHook(() => useSharedLists(), { wrapper })
    expect(result.current.enabled).toBe(false)
  })
})

describe('flag key', () => {
  it('is the release flag registered for SL9', () => {
    expect(SHARED_LISTS_FLAG_KEY).toBe('fuzefront.selection-lists.shared-lists')
  })

  it('matches the key the flag catalog and registry declare (a typo here would silently pin the UI OFF)', () => {
    const catalog = readFileSync(
      resolve(__dirname, '../../../../feature-flags/src/catalog.ts'),
      'utf8'
    )
    expect(catalog).toContain(
      `SELECTION_LISTS_SHARED_LISTS: '${SHARED_LISTS_FLAG_KEY}'`
    )
    const registry = readFileSync(
      resolve(__dirname, '../../../../feature-flags/flag-registry.yaml'),
      'utf8'
    )
    expect(registry).toContain(`- key: ${SHARED_LISTS_FLAG_KEY}`)
  })
})
