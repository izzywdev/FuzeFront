// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  connectPortalNavigation,
  navigatePortalView,
  pathForView,
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
    expect(viewFromPathname('/operations')).toBe('operations')
    expect(viewFromPathname('/')).toBe('overview')
    expect(pathForView('operations', true)).toBe('/app/fuzequality/operations')
    expect(pathForView('operations', false)).toBe('/operations')
  })

  it('routes embedded app actions through the host and preserves standalone history', () => {
    const navigate = vi.fn()
    const pushState = vi.fn()
    const bridge = { navigate } as FuzeFrontRuntimeBridge

    navigatePortalView('repositories', true, bridge, { pushState })
    expect(navigate).toHaveBeenCalledWith('/app/fuzequality/repositories')
    expect(pushState).not.toHaveBeenCalled()

    navigatePortalView('operations', false, undefined, { pushState })
    expect(pushState).toHaveBeenCalledWith({}, '', '/operations')
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
