import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from './mount'
import type { AuthTransport, AuthenticatedSession } from '../types'

const AUTHENTICATED: AuthenticatedSession = {
  status: 'authenticated',
  token: 'tok-123',
  // Must satisfy the contract's `User` shape. Was `{ id: 'u1' }`, which only
  // compiled while SessionResult.user was `unknown` — the gap this change closes.
  user: { id: 'u1', email: 'u1@example.test', roles: [] },
}

function makeTransport(overrides: Partial<AuthTransport> = {}): AuthTransport {
  return {
    login: vi.fn().mockResolvedValue(AUTHENTICATED),
    signup: vi.fn().mockResolvedValue(AUTHENTICATED),
    getAuthMethods: vi.fn().mockResolvedValue({
      password: true,
      social: [],
      mfa: { enabled: false, types: [] },
      verification: { email: false, sms: false },
    }),
    ...overrides,
  }
}

describe('vanilla mount()', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  it('renders email/password inputs and a submit button', () => {
    mount(container, { transport: makeTransport(), onAuthenticated: vi.fn() })
    expect(container.querySelector('#fzf-auth-vanilla-email')).toBeTruthy()
    expect(container.querySelector('#fzf-auth-vanilla-password')).toBeTruthy()
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Sign In')
  })

  it('calls transport.login on submit and onAuthenticated with the result', async () => {
    const transport = makeTransport()
    const onAuthenticated = vi.fn()
    mount(container, { transport, onAuthenticated })

    const email = container.querySelector<HTMLInputElement>('#fzf-auth-vanilla-email')!
    const password = container.querySelector<HTMLInputElement>('#fzf-auth-vanilla-password')!
    email.value = 'a@b.com'
    password.value = 'hunter2'

    const form = container.querySelector('form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await new Promise((r) => setTimeout(r, 0))
    expect(transport.login).toHaveBeenCalledWith({ email: 'a@b.com', password: 'hunter2' })
    expect(onAuthenticated).toHaveBeenCalledWith(AUTHENTICATED)
  })

  it('defaults social to OFF even when startSocial is provided', async () => {
    const transport = makeTransport({
      startSocial: vi.fn().mockResolvedValue(undefined),
      getAuthMethods: vi.fn().mockResolvedValue({
        password: true,
        social: ['google'],
        mfa: { enabled: false, types: [] },
        verification: { email: false, sms: false },
      }),
    })
    mount(container, { transport, onAuthenticated: vi.fn() })
    await new Promise((r) => setTimeout(r, 0))
    const socialWrap = container.querySelector('.fzf-auth-panel__social') as HTMLElement
    expect(socialWrap.style.display).toBe('none')
  })

  it('renders the Google button when social: true is explicitly opted in', async () => {
    const transport = makeTransport({
      startSocial: vi.fn().mockResolvedValue(undefined),
      getAuthMethods: vi.fn().mockResolvedValue({
        password: true,
        social: ['google'],
        mfa: { enabled: false, types: [] },
        verification: { email: false, sms: false },
      }),
    })
    mount(container, { transport, onAuthenticated: vi.fn(), social: true })
    await new Promise((r) => setTimeout(r, 0))
    const socialWrap = container.querySelector('.fzf-auth-panel__social') as HTMLElement
    expect(socialWrap.style.display).toBe('block')
  })

  // Regression — the fallback used while getAuthMethods() is in flight (and
  // again if it fails) must match the security service's real default (Google
  // enabled), not silently disagree with it — see the FALLBACK_METHODS
  // doc-comment in ./mount.ts. Opting into `social: true` here is what a host
  // that WANTS the button would set; a failed fetch must not then hide it.
  it('still shows the Google button when getAuthMethods() fails outright and social is opted in', async () => {
    const transport = makeTransport({
      startSocial: vi.fn().mockResolvedValue(undefined),
      getAuthMethods: vi.fn().mockRejectedValue(new Error('network error')),
    })
    mount(container, { transport, onAuthenticated: vi.fn(), social: true })
    await new Promise((r) => setTimeout(r, 0))
    const socialWrap = container.querySelector('.fzf-auth-panel__social') as HTMLElement
    expect(socialWrap.style.display).toBe('block')
  })

  it('unmount() removes the rendered markup', () => {
    const handle = mount(container, { transport: makeTransport(), onAuthenticated: vi.fn() })
    expect(container.querySelector('.fzf-auth-panel')).toBeTruthy()
    handle.unmount()
    expect(container.querySelector('.fzf-auth-panel')).toBeFalsy()
  })
})
