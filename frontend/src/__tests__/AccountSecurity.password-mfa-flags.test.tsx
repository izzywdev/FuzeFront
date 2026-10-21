/**
 * Flag gating for the account-security password / MFA host routes
 * (FFRNT-140 / FFRNT-141 / FFRNT-362). Every flag defaults OFF; BOTH states are
 * exercised per surface (feature-flags skill). The package flows are stubbed —
 * their behaviour is covered in packages/account-security-ui; this file proves the
 * host only mounts them when the matching flag is ON, and that flag OFF leaves the
 * hub exactly as it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let flags: Record<string, boolean> = {}
let ready = true
vi.mock('../platform/featureFlags', () => ({
  useFlag: (key: string, fallback = false) => (key in flags ? flags[key] : fallback),
  useFlagState: (key: string, fallback = false) => ({
    enabled: ready && key in flags ? flags[key] : fallback,
    ready,
  }),
}))
vi.mock('../lib/accounts', () => ({ getActiveAuthToken: () => 'tok' }))

let language = 'en'
vi.mock('@fuzefront/i18n', () => ({
  useT: () => ({ t: (k: string) => k, i18n: { resolvedLanguage: language, language } }),
}))
let authExperience = false
vi.mock('@fuzefront/auth-ui', () => ({ isAuthExperienceEnabled: () => authExperience }))
const pwProps = vi.fn()
const mfaProps = vi.fn()
const phoneProps = vi.fn()

const hubProps = vi.fn()
const statusProps = vi.fn()
vi.mock('@fuzefront/account-security-ui', () => {
  const stub = (id: string) => (props: Record<string, unknown>) => <div data-testid={id} data-props={Object.keys(props).join(',')} />
  return {
    PasswordManagementFlow: (props: Record<string, unknown>) => {
      pwProps(props)
      return <div data-testid="password-flow" />
    },
    MfaOverviewFlow: (props: Record<string, unknown>) => {
      mfaProps(props)
      return <div data-testid="mfa-overview" />
    },
    TotpEnrollFlow: stub('mfa-totp'),
    SmsEnrollFlow: stub('mfa-sms'),
    RecoveryCodesFlow: stub('mfa-recovery'),
    ConfirmContactFlow: (props: Record<string, unknown>) => {
      phoneProps(props)
      return <div data-testid="confirm-contact" />
    },
    SecurityStatusMobileFlow: (props: Record<string, unknown>) => {
      statusProps(props)
      return <div data-testid="security-status-mobile" />
    },
    AccountSecurityHub: (props: Record<string, unknown>) => {
      hubProps(props)
      return <div data-testid="hub" />
    },
  }
})

import AccountPasswordPage from '../pages/AccountPasswordPage'
import AccountMfaPage from '../pages/AccountMfaPage'
import AccountVerifyPhonePage from '../pages/AccountVerifyPhonePage'
import AccountSecurityPage from '../pages/AccountSecurityPage'

const PW = 'fuzefront.account-security.password-reset'
const MFA = 'fuzefront.security.mfa-management'
const MOBILE = 'fuzefront.security.mfa-stepup-mobile'
const HUB = 'fuzefront.account-security.hub'

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

beforeEach(() => {
  flags = {}
  ready = true
  language = 'en'
  authExperience = false
  pwProps.mockClear()
  mfaProps.mockClear()
  phoneProps.mockClear()
  hubProps.mockClear()
  statusProps.mockClear()
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

describe('/account/security/password — fuzefront.account-security.password-reset', () => {
  it('OFF (default): not exposed', () => {
    inRouter(<AccountPasswordPage />)
    expect(screen.queryByTestId('password-flow')).toBeNull()
    expect(screen.getByText(/isn’t available yet/i)).toBeInTheDocument()
  })
  it('ON: mounts the password flow', () => {
    flags = { [PW]: true }
    inRouter(<AccountPasswordPage />)
    expect(screen.getByTestId('password-flow')).toBeInTheDocument()
  })
  it('/reset exits are offered only when the auth experience (which mounts /reset) is enabled', () => {
    flags = { [PW]: true }
    inRouter(<AccountPasswordPage />)
    expect(pwProps.mock.calls[0][0].canReset).toBe(false)
    pwProps.mockClear()
    authExperience = true
    inRouter(<AccountPasswordPage />)
    expect(pwProps.mock.calls[0][0].canReset).toBe(true)
  })
  it('passes the active language as the package locale (he -> he, unsupported -> en)', () => {
    flags = { [PW]: true, [MFA]: true, [MOBILE]: true }
    language = 'he-IL'
    inRouter(<AccountPasswordPage />)
    inRouter(<AccountMfaPage view="overview" />)
    inRouter(<AccountVerifyPhonePage />)
    expect(pwProps.mock.calls[0][0].locale).toBe('he')
    expect(mfaProps.mock.calls[0][0].locale).toBe('he')
    expect(phoneProps.mock.calls[0][0].locale).toBe('he')
    pwProps.mockClear()
    language = 'fr'
    inRouter(<AccountPasswordPage />)
    expect(pwProps.mock.calls[0][0].locale).toBe('en')
  })
  it('flags not yet fetched: renders nothing (neither the surface nor a false "unavailable")', () => {
    ready = false
    inRouter(<AccountPasswordPage />)
    expect(screen.queryByTestId('password-flow')).toBeNull()
    expect(screen.queryByText(/isn’t available yet/i)).toBeNull()
  })
})

describe('/account/security/mfa* — fuzefront.security.mfa-management', () => {
  const views = [
    ['overview', 'mfa-overview'],
    ['authenticator', 'mfa-totp'],
    ['phone', 'mfa-sms'],
    ['recovery-codes', 'mfa-recovery'],
  ] as const
  it.each(views)('OFF (default): %s is not exposed', (view, id) => {
    inRouter(<AccountMfaPage view={view} />)
    expect(screen.queryByTestId(id)).toBeNull()
  })
  it.each(views)('ON: %s mounts its flow', (view, id) => {
    flags = { [MFA]: true }
    inRouter(<AccountMfaPage view={view} />)
    expect(screen.getByTestId(id)).toBeInTheDocument()
  })
})

describe('/account/security/verify/phone — fuzefront.security.mfa-stepup-mobile', () => {
  it('OFF (default): not exposed', () => {
    inRouter(<AccountVerifyPhonePage />)
    expect(screen.queryByTestId('confirm-contact')).toBeNull()
  })
  it('ON: mounts the confirm-phone flow', () => {
    flags = { [MOBILE]: true }
    inRouter(<AccountVerifyPhonePage />)
    expect(screen.getByTestId('confirm-contact')).toBeInTheDocument()
  })
})

describe('/account/security hub integration', () => {
  it('all new flags OFF: the hub is unchanged (no route override, no mobile status panel)', () => {
    flags = { [HUB]: true }
    inRouter(<AccountSecurityPage />)
    expect(screen.getByTestId('hub')).toBeInTheDocument()
    expect(screen.queryByTestId('security-status-mobile')).toBeNull()
    expect(hubProps.mock.calls[0][0].routes).toBeUndefined()
  })

  it('mfa-management ON: the two-factor card routes to /account/security/mfa', () => {
    flags = { [HUB]: true, [MFA]: true }
    inRouter(<AccountSecurityPage />)
    expect(hubProps.mock.calls[0][0].routes).toEqual({ twoFactor: '/account/security/mfa' })
  })

  it('mobile ON but a wide viewport: no mobile status panel (additive, small screens only)', () => {
    flags = { [HUB]: true, [MOBILE]: true }
    inRouter(<AccountSecurityPage />)
    expect(screen.queryByTestId('security-status-mobile')).toBeNull()
  })

  it('mobile ON at a small viewport: the combined status panel renders above the hub', () => {
    flags = { [HUB]: true, [MOBILE]: true }
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    inRouter(<AccountSecurityPage />)
    expect(screen.getByTestId('security-status-mobile')).toBeInTheDocument()
    expect(screen.getByTestId('hub')).toBeInTheDocument()
    // mfa-management OFF: the status panel must not offer a link into the gated MFA routes.
    expect(statusProps.mock.calls[0][0].addMethodEnabled).toBe(false)
  })

  it('mobile ON + mfa-management ON: the status panel offers "add method"', () => {
    flags = { [HUB]: true, [MOBILE]: true, [MFA]: true }
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    inRouter(<AccountSecurityPage />)
    expect(statusProps.mock.calls[0][0].addMethodEnabled).toBe(true)
  })

  it('hub flag OFF: nothing new leaks onto the page even with the new flags ON', () => {
    flags = { [MFA]: true, [MOBILE]: true }
    inRouter(<AccountSecurityPage />)
    expect(screen.queryByTestId('hub')).toBeNull()
    expect(screen.queryByTestId('security-status-mobile')).toBeNull()
  })
})
