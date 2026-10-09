// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  connectPortalNavigation,
  portalMenuItems,
  viewFromPathname,
  type FuzeFrontRuntimeBridge,
  type View,
} from './App'

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('FuzeFront portal navigation bridge', () => {
  it('publishes the app submenu without exposing platform administration', () => {
    expect(portalMenuItems.map(item => item.id)).toEqual([
      'overview', 'repositories', 'api', 'frontend', 'requirements',
      'intelligence', 'review', 'operations', 'organization',
    ])
    expect(portalMenuItems.every(item => item.route === `/${item.id}`)).toBe(true)
  })

  it('recognizes only valid FuzeQuality deep links', () => {
    expect(viewFromPathname('/app/fuzequality')).toBe('overview')
    expect(viewFromPathname('/app/fuzequality/')).toBe('overview')
    expect(viewFromPathname('/app/fuzequality/intelligence')).toBe('intelligence')
    expect(viewFromPathname('/app/fuzequality/not-a-view')).toBeUndefined()
    expect(viewFromPathname('/app/another/overview')).toBeUndefined()
  })

  it('syncs initial links, host submenu events, and browser history, then cleans up', () => {
    const add = vi.fn()
    const remove = vi.fn()
    const setView = vi.fn<(view: View) => void>()
    const bridge = { menu: { add, remove } } as FuzeFrontRuntimeBridge
    window.history.replaceState({}, '', '/app/fuzequality/requirements')

    const disconnect = connectPortalNavigation(bridge, setView)
    expect(add).toHaveBeenCalledWith('fuzequality', portalMenuItems)
    expect(setView).toHaveBeenLastCalledWith('requirements')

    window.dispatchEvent(new CustomEvent('fuzefront:navigate', {
      detail: { id: 'review', section: 'review', route: '/review' },
    }))
    expect(setView).toHaveBeenLastCalledWith('review')

    window.history.pushState({}, '', '/app/fuzequality/operations')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(setView).toHaveBeenLastCalledWith('operations')

    window.history.pushState({}, '', '/app/fuzequality/')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(setView).toHaveBeenLastCalledWith('overview')

    disconnect()
    expect(remove).toHaveBeenCalledWith('fuzequality')
    window.dispatchEvent(new CustomEvent('fuzefront:navigate', { detail: { id: 'overview' } }))
    expect(setView).toHaveBeenCalledTimes(4)
  })
})
