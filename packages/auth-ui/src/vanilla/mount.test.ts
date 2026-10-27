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
    expect(onAuthenticated).toHaveBeenCalledWith(AUTHENTICATED, { mode: 'signin', email: 'a@b.com' })
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

  it('signup mode sends the contract\'s single optional `name` (no firstName/lastName)', async () => {
    const transport = makeTransport()
    mount(container, { transport, onAuthenticated: vi.fn(), mode: 'signup' })
    expect(container.querySelector('#fzf-auth-vanilla-name')).toHaveProperty('autocomplete', 'name')
    expect(container.querySelector('#fzf-auth-vanilla-firstName')).toBeNull()
    expect(container.querySelector('#fzf-auth-vanilla-lastName')).toBeNull()
    ;(container.querySelector('#fzf-auth-vanilla-name') as HTMLInputElement).value = ' Ada Lovelace '
    ;(container.querySelector('#fzf-auth-vanilla-email') as HTMLInputElement).value = 'ada@ex.com'
    ;(container.querySelector('#fzf-auth-vanilla-password') as HTMLInputElement).value = 'S3cret!!!!'
    container.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(transport.signup).toHaveBeenCalledWith({
      email: 'ada@ex.com',
      password: 'S3cret!!!!',
      name: 'Ada Lovelace',
    })
  })

  it('unmount() removes the rendered markup', () => {
    const handle = mount(container, { transport: makeTransport(), onAuthenticated: vi.fn() })
    expect(container.querySelector('.fzf-auth-panel')).toBeTruthy()
    handle.unmount()
    expect(container.querySelector('.fzf-auth-panel')).toBeFalsy()
  })
  it('renders no Forgot password? link by default (flag OFF = today)', () => {
    mount(container, { transport: makeTransport(), onAuthenticated: vi.fn() })
    expect(container.querySelector('.fzf-auth-panel__forgot')).toBeNull()
  })

  it('renders a sign-in-only Forgot password? link and calls the SPA handler', () => {
    const onForgotPassword = vi.fn()
    mount(container, {
      transport: makeTransport(),
      onAuthenticated: vi.fn(),
      forgotPasswordHref: '/reset',
      onForgotPassword,
    })
    const link = container.querySelector<HTMLAnchorElement>('.fzf-auth-panel__forgot')!
    expect(link.getAttribute('href')).toBe('/reset')
    expect(link.textContent).toBe('Forgot password?')
    expect(link.style.display).not.toBe('none')
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onForgotPassword).toHaveBeenCalled()
    // toggle to sign-up: the link is hidden
    container.querySelector<HTMLButtonElement>('.fzf-auth-panel__toggle button')!.click()
    expect(link.style.display).toBe('none')
  })

  it('reports the SUBMITTED email even if the field changes while the request is in flight', async () => {
    let release!: (v: AuthenticatedSession) => void
    const transport = makeTransport({
      login: vi.fn(() => new Promise<AuthenticatedSession>((res) => (release = res))),
    })
    const onAuthenticated = vi.fn()
    mount(container, { transport, onAuthenticated })
    const email = container.querySelector<HTMLInputElement>('#fzf-auth-vanilla-email')!
    email.value = 'first@b.com'
    container.querySelector<HTMLInputElement>('#fzf-auth-vanilla-password')!.value = 'pw'
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 0))
    email.value = 'changed@b.com' // edited mid-flight
    release(AUTHENTICATED)
    await new Promise((r) => setTimeout(r, 0))
    expect(transport.login).toHaveBeenCalledWith({ email: 'first@b.com', password: 'pw' })
    expect(onAuthenticated).toHaveBeenCalledWith(AUTHENTICATED, { mode: 'signin', email: 'first@b.com' })
  })
})
