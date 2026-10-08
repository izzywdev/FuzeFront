import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bridge, PlatformSnapshot } from '../bridge'

describe('PlatformBridge org and account switch events', () => {
  const initialCtx: PlatformSnapshot = {
    user: { id: 'usr-1', email: 'user1@example.com', roles: ['user'] },
    apps: [],
    activeApp: null,
    activeOrganization: { id: 'org-1', name: 'Org One' },
    isPlatformMode: true,
  }

  beforeEach(() => {
    bridge.setContext(initialCtx)
  })

  it('triggers onOrgSwitch listener and dispatches fuzefront:org-switched DOM event on org change', () => {
    const orgListener = vi.fn()
    const unsubscribe = bridge.onOrgSwitch(orgListener)

    const domListener = vi.fn()
    window.addEventListener('fuzefront:org-switched', domListener as EventListener)

    const updatedCtx: PlatformSnapshot = {
      ...initialCtx,
      activeOrganization: { id: 'org-2', name: 'Org Two' },
    }

    bridge.setContext(updatedCtx)

    expect(orgListener).toHaveBeenCalledWith({ id: 'org-2', name: 'Org Two' })
    expect(domListener).toHaveBeenCalled()
    const event = domListener.mock.calls[0][0] as CustomEvent
    expect(event.detail.organizationId).toBe('org-2')
    expect(event.detail.organization.name).toBe('Org Two')

    unsubscribe()
    window.removeEventListener('fuzefront:org-switched', domListener as EventListener)
  })

  it('triggers onAccountSwitch listener and dispatches fuzefront:account-switched DOM event on user change', () => {
    const accountListener = vi.fn()
    const unsubscribe = bridge.onAccountSwitch(accountListener)

    const domListener = vi.fn()
    window.addEventListener('fuzefront:account-switched', domListener as EventListener)

    const updatedCtx: PlatformSnapshot = {
      ...initialCtx,
      user: { id: 'usr-2', email: 'user2@example.com', roles: ['admin'] },
    }

    bridge.setContext(updatedCtx)

    expect(accountListener).toHaveBeenCalledWith({
      id: 'usr-2',
      email: 'user2@example.com',
      roles: ['admin'],
    })
    expect(domListener).toHaveBeenCalled()
    const event = domListener.mock.calls[0][0] as CustomEvent
    expect(event.detail.userId).toBe('usr-2')

    unsubscribe()
    window.removeEventListener('fuzefront:account-switched', domListener as EventListener)
  })

  it('handles switching to personal context (null organization)', () => {
    const orgListener = vi.fn()
    const unsubscribe = bridge.onOrgSwitch(orgListener)

    bridge.setContext({
      ...initialCtx,
      activeOrganization: null,
    })

    expect(orgListener).toHaveBeenCalledWith(null)
    unsubscribe()
  })
})
