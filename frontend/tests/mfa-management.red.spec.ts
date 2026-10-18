/**
 * MFA MANAGEMENT — TDD RED UI e2e (FFRNT-141).
 *
 * Derived STRICTLY from design/frames/mfa-management/ (manifest testHooks) and
 * the frozen contract packages/security/openapi.yaml:
 *   GET    /v1/security/methods                       -> AuthMethods (mfa.types gates SMS)
 *   GET    /v1/security/mfa/factors                   -> { items: MfaFactor[] }
 *   POST   /v1/security/mfa/factors                   -> 201 MfaEnrollResult
 *   POST   /v1/security/mfa/factors/{id}/activate     -> 200 MfaFactor | 400
 *   DELETE /v1/security/mfa/factors/{id}              -> 204 | 409 (remove-last)
 *   POST   /v1/security/mfa/recovery-codes            -> { codes: string[] }  (REVEAL ONCE)
 *   POST   /v1/security/mfa/challenge | /mfa/verify   -> step-up (/login/mfa, pre-auth)
 *
 * Flows (build.flows): mfa-overview, totp-enroll, sms-enroll, recovery-codes,
 * mfa-step-up. Release flag `fuzefront.security.mfa-management` (default OFF).
 * Authenticated surfaces force it ON via GET /api/flags; the pre-auth step-up
 * uses the window.__FF_FLAGS__ override (see password-change.red.spec.ts).
 *
 * Explicit fail-closed specs: reveal-once recovery codes; remove-last-factor 409;
 * SMS channel-unavailable honest degrade; wrong/expired code stays on screen.
 *
 * Run: BASE_URL=http://fuzefront.dev.local npx playwright test mfa-management.red
 */
import { test, expect, type Page } from '@playwright/test'
import { installShellMocks, KNOWN_SHELL_NOISE_RE, seedAuth } from './support/mock-shell'

const FLAG = 'fuzefront.security.mfa-management'
const OVERVIEW = '/account/security/mfa'
const FORBIDDEN_VENDORS = ['Authentik', 'authentik', 'Permit', 'permit.io']

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const TOTP = { factorId: 'fct_totp_1', type: 'totp', status: 'active', label: 'Authenticator app', createdAt: 1781222400000 }
const SMS = { factorId: 'fct_sms_1', type: 'sms', status: 'active', label: '•••• •• 4471', createdAt: 1781222400000 }

function methods(types: string[]) {
  return { password: true, social: ['google'], mfa: { enabled: types.length > 0, types }, verification: { email: true, sms: types.includes('sms') } }
}

async function seedSession(page: Page) {
  await seedAuth(page)
}

async function mockFlags(page: Page, on: boolean) {
  await installShellMocks(page, { [FLAG]: on, 'fuzefront.account-security.hub': true })
}

async function mockMethods(page: Page, types: string[]) {
  await page.route('**/v1/security/methods', route => route.fulfill(json(200, methods(types))))
}

async function mockFactors(page: Page, items: unknown[]) {
  await page.route('**/v1/security/mfa/factors', route => {
    if (route.request().method() === 'GET') return route.fulfill(json(200, { items }))
    return route.fallback()
  })
}

test.describe('MFA overview (frame 01-mfa-overview)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
  })

  test('flag OFF: the MFA surface is not exposed', async ({ page }) => {
    await mockFlags(page, false)
    await mockMethods(page, ['totp'])
    await mockFactors(page, [TOTP])
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-frame='01-mfa-overview']")).toHaveCount(0)
    await expect(page.locator("[data-panel='mfa-overview']")).toHaveCount(0)
  })

  test('loaded: lists enrolled factors with neutral labels and a remove action', async ({ page }) => {
    await mockMethods(page, ['totp', 'sms'])
    await mockFactors(page, [TOTP, SMS])
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    const panel = page.locator("[data-panel='mfa-overview'][data-state='loaded']")
    await expect(panel).toBeVisible()
    await expect(panel.locator("[data-factor='totp']")).toBeVisible()
    await expect(panel.locator("[data-factor='sms']")).toContainText('4471')
    await expect(panel.locator("[data-action='remove-factor']").first()).toBeVisible()
  })

  test('empty: no factors invites first enrolment', async ({ page }) => {
    await mockMethods(page, ['totp'])
    await mockFactors(page, [])
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='mfa-overview'][data-state='empty']")).toBeVisible()
    await expect(page.locator("[data-action='enroll-first']")).toBeVisible()
  })

  test('loading skeleton then resolves', async ({ page }) => {
    await mockMethods(page, ['totp'])
    await page.route('**/v1/security/mfa/factors', async route => {
      await new Promise(r => setTimeout(r, 400))
      return route.fulfill(json(200, { items: [TOTP] }))
    })
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='mfa-overview'][data-state='loading']")).toBeVisible()
    await expect(page.locator("[data-panel='mfa-overview'][data-state='loaded']")).toBeVisible()
  })

  test('load error offers retry and the retry recovers', async ({ page }) => {
    await mockMethods(page, ['totp'])
    // State-based (not call-counted): dev-mode StrictMode double-invokes the mount effect.
    let failing = true
    await page.route('**/v1/security/mfa/factors', route =>
      failing ? route.fulfill(json(500, { error: 'boom' })) : route.fulfill(json(200, { items: [TOTP] })),
    )
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='mfa-overview'][data-state='error']")).toBeVisible()
    failing = false
    await page.locator("[data-action='retry']").click()
    await expect(page.locator("[data-panel='mfa-overview'][data-state='loaded']")).toBeVisible()
  })

  test('honest degrade: SMS is offered ONLY when methods.mfa.types includes sms', async ({ page }) => {
    await mockMethods(page, ['totp'])
    await mockFactors(page, [TOTP])
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-add='totp']")).toBeVisible()
    await expect(page.locator("[data-add='sms']")).toHaveCount(0)
  })

  test('recovery-codes status is linked from the overview', async ({ page }) => {
    await mockMethods(page, ['totp'])
    await mockFactors(page, [TOTP])
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='recovery-status']")).toBeVisible()
    await expect(page.locator("[data-action='view-recovery']")).toBeVisible()
  })
})

test.describe('TOTP enrolment (frame 02-totp-enroll)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
    await mockMethods(page, ['totp'])
    await page.route('**/v1/security/mfa/factors', route => {
      if (route.request().method() === 'POST') {
        return route.fulfill(
          json(201, {
            factorId: 'fct_totp_new',
            type: 'totp',
            status: 'pending',
            secret: 'JBSWY3DPEHPK3PXP',
            provisioningUri: 'otpauth://totp/FuzeFront:amara@rowan.co?secret=JBSWY3DPEHPK3PXP&issuer=FuzeFront',
          }),
        )
      }
      return route.fulfill(json(200, { items: [] }))
    })
  })

  test('opening the route creates nothing; Start enrols, then shows QR + copyable setup key + 6-cell OTP input', async ({ page }) => {
    let enrolCalls = 0
    await page.route('**/v1/security/mfa/factors', route => {
      if (route.request().method() === 'POST') enrolCalls += 1
      return route.fallback()
    })
    await page.goto('/account/security/mfa/add/authenticator', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-component='totp-enroll'][data-state='intro']")).toBeVisible()
    expect(enrolCalls).toBe(0)
    await page.locator("[data-action='start-setup']").click()
    const card = page.locator("[data-component='totp-enroll'][data-state='scan']")
    await expect(card).toBeVisible()
    await expect(card.locator('[data-provisioning-uri]')).toBeVisible()
    await expect(card.locator('[data-secret]')).toContainText('JBSW')
    await expect(card.locator("[data-action='copy-secret']")).toBeVisible()
    await expect(card.locator("[data-component='otp-input'] input")).toHaveCount(6)
  })

  test('wrong code (400) fails closed: inline error, factor NOT activated, stays on screen', async ({ page }) => {
    // Real backend: a wrong / expired factor code is 401 NOT_ACTIVE (the contract also allows 400).
    await page.route('**/v1/security/mfa/factors/*/activate', route =>
      route.fulfill(json(401, { error: 'invalid code', code: 'NOT_ACTIVE' })),
    )
    await page.goto('/account/security/mfa/add/authenticator', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-action='start-setup']").click()
    const otp = page.locator("[data-component='otp-input']")
    await otp.locator('input').first().click()
    await page.keyboard.type('111111')
    await page.locator("[data-action='activate-factor']").click()
    await expect(page.locator("[data-state='error-invalid']")).toBeVisible()
    await expect(page.locator("[data-error='invalid-code']")).toBeVisible()
    expect(page.url()).toContain('/mfa/add/authenticator')
  })

  test('cancelling after Start DELETEs the pending factor (best-effort cleanup)', async ({ page }) => {
    let deleted = ''
    await page.route('**/v1/security/mfa/factors/*', route => {
      if (route.request().method() === 'DELETE') {
        deleted = route.request().url()
        return route.fulfill({ status: 204 })
      }
      return route.fallback()
    })
    await page.goto('/account/security/mfa/add/authenticator', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-action='start-setup']").click()
    await expect(page.locator("[data-component='totp-enroll'][data-state='scan']")).toBeVisible()
    await page.locator("[data-component='totp-enroll'] [data-action='cancel']").click()
    await expect.poll(() => deleted).toContain('fct_totp_new')
  })

  test('OTP input is paste-aware', async ({ page }) => {
    await page.goto('/account/security/mfa/add/authenticator', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-action='start-setup']").click()
    const inputs = page.locator("[data-component='otp-input'] input")
    await inputs.first().click()
    await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement
      const dt = new DataTransfer()
      dt.setData('text', '492017')
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect(inputs.nth(5)).toHaveValue('7')
  })
})

test.describe('SMS enrolment (frame 03-sms-enroll) — leads with channel-unavailable', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
    await mockFactors(page, [])
  })

  test('sms NOT in mfa.types: channel-unavailable, disabled field, routes to TOTP, NO code sent', async ({ page }) => {
    await mockMethods(page, ['totp'])
    let enrolCalls = 0
    await page.route('**/v1/security/mfa/factors', route => {
      if (route.request().method() === 'POST') enrolCalls += 1
      return route.fallback()
    })
    await page.goto('/account/security/mfa/add/phone', { waitUntil: 'domcontentloaded' })
    const unavailable = page.locator("[data-component='channel-unavailable'][data-available='false']")
    await expect(unavailable).toBeVisible()
    await expect(page.locator("input[type='tel']")).toBeDisabled()
    await expect(page.locator("[data-action='send-code']")).toHaveCount(0)
    expect(enrolCalls).toBe(0)
  })

  test('sms available: enter phone -> confirm code', async ({ page }) => {
    await mockMethods(page, ['totp', 'sms'])
    await page.route('**/v1/security/mfa/factors', route => {
      if (route.request().method() === 'POST') {
        return route.fulfill(json(201, { factorId: 'fct_sms_new', type: 'sms', status: 'pending', codeSent: true }))
      }
      return route.fulfill(json(200, { items: [] }))
    })
    await page.goto('/account/security/mfa/add/phone', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-component='sms-enroll'][data-state='enter-phone']")).toBeVisible()
    await page.locator("[data-field='phone']").fill('+44 7700 900471')
    await page.locator("[data-action='send-code']").click()
    await expect(page.locator("[data-component='sms-enroll'][data-state='confirm-code']")).toBeVisible()
  })

  test('wrong / expired code fails closed with an inline error', async ({ page }) => {
    await mockMethods(page, ['totp', 'sms'])
    await page.route('**/v1/security/mfa/factors', route => {
      if (route.request().method() === 'POST') {
        return route.fulfill(json(201, { factorId: 'fct_sms_new', type: 'sms', status: 'pending', codeSent: true }))
      }
      return route.fulfill(json(200, { items: [] }))
    })
    // Real backend: a wrong / expired factor code is 401 NOT_ACTIVE (the contract also allows 400).
    await page.route('**/v1/security/mfa/factors/*/activate', route =>
      route.fulfill(json(401, { error: 'invalid code', code: 'NOT_ACTIVE' })),
    )
    await page.goto('/account/security/mfa/add/phone', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-field='phone']").fill('+44 7700 900471')
    await page.locator("[data-action='send-code']").click()
    await page.locator("[data-component='otp-input'] input").first().click()
    await page.keyboard.type('000000')
    await page.locator("[data-action='activate-factor']").click()
    await expect(page.locator("[data-state='error-invalid']")).toBeVisible()
    await expect(page.locator("[data-error='invalid-code']")).toBeVisible()
  })
})

test.describe('Recovery codes (frame 04) — REVEAL ONCE', () => {
  const CODES = ['4f2a-9c11', '8b7d-1e04', '2a6f-77bc', 'c390-4de1', '9e15-6a02', '0b84-3f7a', '7d21-e9c8', '5c60-12ab', 'a1f9-84d3', '3e77-b520']

  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
    await mockMethods(page, ['totp'])
    await mockFactors(page, [TOTP])
  })

  test('landing shows STATUS only — codes are never fetched or displayed until regenerated', async ({ page }) => {
    let regenCalls = 0
    await page.route('**/v1/security/mfa/recovery-codes', route => {
      regenCalls += 1
      return route.fulfill(json(200, { codes: CODES }))
    })
    await page.goto('/account/security/mfa/recovery-codes', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-component='recovery-codes'][data-state='status']")).toBeVisible()
    await expect(page.locator('[data-codes] code')).toHaveCount(0)
    expect(regenCalls).toBe(0)
  })

  test('regenerate requires an explicit acknowledgement that old codes stop working', async ({ page }) => {
    await page.route('**/v1/security/mfa/recovery-codes', route => route.fulfill(json(200, { codes: CODES })))
    await page.goto('/account/security/mfa/recovery-codes', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-action='regenerate-open']").click()
    const dialog = page.locator("[data-component='recovery-codes'][data-state='regenerate-confirm']")
    await expect(dialog).toBeVisible()
    await expect(dialog.locator("[data-action='regenerate-confirm']")).toBeDisabled()
    await dialog.locator("[data-field='ack-invalidate']").check()
    await expect(dialog.locator("[data-action='regenerate-confirm']")).toBeEnabled()
  })

  test('codes are shown exactly ONCE: after dismissing they cannot be re-read and are never re-fetched', async ({ page }) => {
    let calls = 0
    await page.route('**/v1/security/mfa/recovery-codes', route => {
      calls += 1
      return route.fulfill(json(200, { codes: CODES }))
    })
    await page.goto('/account/security/mfa/recovery-codes', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-action='regenerate-open']").click()
    await page.locator("[data-field='ack-invalidate']").check()
    await page.locator("[data-action='regenerate-confirm']").click()

    const shown = page.locator("[data-component='recovery-codes'][data-state='shown-once']")
    await expect(shown).toBeVisible()
    await expect(shown.locator('[data-codes] code')).toHaveCount(10)
    await expect(shown.locator('[data-codes]')).toContainText('4f2a-9c11')
    await expect(shown.locator("[data-action='download-codes']")).toBeVisible()
    await expect(shown.locator("[data-action='copy-codes']")).toBeVisible()
    await expect(shown.locator("[data-action='print-codes']")).toBeVisible()
    expect(calls).toBe(1)

    // Leave and come back: the codes are gone from the DOM and were not re-fetched.
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await page.goto('/account/security/mfa/recovery-codes', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-component='recovery-codes'][data-state='status']")).toBeVisible()
    await expect(page.locator('body')).not.toContainText('4f2a-9c11')
    expect(calls).toBe(1)
  })

  test('regeneration failure surfaces an error and reveals NO codes', async ({ page }) => {
    await page.route('**/v1/security/mfa/recovery-codes', route => route.fulfill(json(500, { error: 'boom' })))
    await page.goto('/account/security/mfa/recovery-codes', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-action='regenerate-open']").click()
    await page.locator("[data-field='ack-invalidate']").check()
    await page.locator("[data-action='regenerate-confirm']").click()
    await expect(page.locator("[data-component='recovery-codes'][data-state='shown-once']")).toHaveCount(0)
    await expect(page.locator("[data-state='error']")).toBeVisible()
  })
})

test.describe('Remove a factor (frame 06) — remove-last is BLOCKED (409)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
    await mockMethods(page, ['totp', 'sms'])
  })

  test('confirm -> DELETE -> removed', async ({ page }) => {
    await mockFactors(page, [TOTP, SMS])
    let deleted = ''
    await page.route('**/v1/security/mfa/factors/*', route => {
      if (route.request().method() === 'DELETE') {
        deleted = route.request().url()
        return route.fulfill({ status: 204 })
      }
      return route.fallback()
    })
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await page.locator("[data-factor='sms'] [data-action='remove-factor']").click()
    const dialog = page.locator("[data-component='remove-factor-dialog'][data-state='confirm']")
    await expect(dialog).toBeVisible()
    await dialog.locator("[data-action='remove-confirm']").click()
    await expect(page.locator("[data-component='remove-factor-dialog'][data-state='removed']")).toBeVisible()
    expect(deleted).toContain('fct_sms_1')
  })

  test('removing the ONLY factor under enforced MFA: server 409 -> blocked state, factor stays', async ({ page }) => {
    await mockFactors(page, [TOTP])
    await page.route('**/v1/security/mfa/factors/*', route => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill(json(409, { error: 'Two-factor is required', code: 'CONFLICT' }))
      }
      return route.fallback()
    })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await page.locator("[data-factor='totp'] [data-action='remove-factor']").click()
    await page
      .locator("[data-component='remove-factor-dialog'][data-state='confirm'] [data-action='remove-confirm']")
      .click()
    const blocked = page.locator("[data-component='remove-factor-dialog'][data-state='remove-last-blocked']")
    await expect(blocked).toBeVisible()
    await expect(blocked).toHaveAttribute('data-http-status', '409')
    await expect(blocked.locator("[data-error='remove-last']")).toBeVisible()
    await expect(page.locator("[data-component='remove-factor-dialog'][data-state='removed']")).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

test.describe('MFA step-up at sign-in (frame 05-step-up-challenge) — pre-auth', () => {
  const CHALLENGE = {
    status: 'mfa_required',
    challengeId: 'chl_1',
    factors: [
      { factorId: 'fct_totp_1', type: 'totp' },
      { factorId: 'fct_sms_1', type: 'sms' },
    ],
  }

  async function reachChallenge(page: Page, flagOn = true) {
    await page.addInitScript(
      ([flag, on]) => {
        const w = window as unknown as { __FF_FLAGS__: Record<string, boolean> }
        w.__FF_FLAGS__ = { [flag as string]: on as boolean }
      },
      [FLAG, flagOn],
    )
    await page.route('**/v1/security/methods', route => route.fulfill(json(200, methods(['totp', 'sms']))))
    await page.route('**/v1/security/session', route => {
      if (route.request().method() === 'POST') return route.fulfill(json(200, CHALLENGE))
      return route.fulfill(json(401, { error: 'no session', code: 'NO_TOKEN' }))
    })
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.getByLabel(/email/i).first().fill('amara@rowan.co')
    await page.getByLabel(/password/i).first().fill('Correct-Horse-Battery-9!')
    // Wait for the sign-in POST to settle so the step-up has been handed the challenge.
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/v1/security/session') && r.request().method() === 'POST'),
      page.locator("button[type='submit']").first().click(),
    ])
  }

  test('EVERY flag OFF: a server mfa_required still renders a working step-up (no lockout)', async ({ page }) => {
    await page.route('**/v1/security/mfa/verify', route => route.fulfill(json(401, { error: 'x', code: 'NOT_ACTIVE' })))
    await reachChallenge(page, false)
    await expect(page.locator("[data-component='mfa-challenge']")).toBeVisible()
    await page.locator("[data-component='otp-input'] input").first().click()
    await page.keyboard.type('123456')
    await expect(page.locator("[data-action='verify-mfa']")).toBeEnabled()
  })

  test('mfa_required renders the challenge card with a factor picker', async ({ page }) => {
    await reachChallenge(page)
    await expect(page.locator("[data-frame='05-step-up-challenge'], [data-component='mfa-challenge']").first()).toBeVisible()
    await expect(page.locator("[data-component='factor-picker'], [data-component='otp-input']").first()).toBeVisible()
  })

  test('wrong / expired code fails closed: stays on screen with inline error', async ({ page }) => {
    await page.route('**/v1/security/mfa/verify', route =>
      route.fulfill(json(401, { error: 'Invalid code', code: 'INVALID_CREDENTIALS' })),
    )
    await page.route('**/v1/security/mfa/challenge', route =>
      route.fulfill(json(202, { challengeId: 'chl_1', factorId: 'fct_totp_1' })),
    )
    await reachChallenge(page)
    const totp = page.locator("[data-factor='totp'][data-action='challenge']")
    if (await totp.count()) await totp.click()
    await page.locator("[data-component='otp-input'] input").first().click()
    await page.keyboard.type('123456')
    await page.locator("[data-action='verify-mfa']").click()
    await expect(page.locator("[data-state='error-invalid']")).toBeVisible()
    await expect(page.locator("[data-error='invalid-code']")).toBeVisible()
    expect(page.url()).toContain('/login')
  })

  test('SMS delivery failure surfaces and offers other factors', async ({ page }) => {
    await page.route('**/v1/security/mfa/challenge', route =>
      route.fulfill(json(503, { error: 'Delivery failed', code: 'PROVIDER_UNAVAILABLE' })),
    )
    await reachChallenge(page)
    // Desktop lands on the authenticator prompt; switch method to reach the SMS option.
    await page.locator("[data-action='choose-factor']").click()
    await page.locator("[data-factor='sms'][data-action='challenge']").click()
    await expect(page.locator("[data-state='error-delivery']")).toBeVisible()
    await expect(page.locator("[data-action='choose-factor']")).toBeVisible()
  })
})

test.describe('MFA — product boundary + console gate', () => {
  test('no identity-vendor name on the overview; console clean', async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
    await mockMethods(page, ['totp', 'sms'])
    await mockFactors(page, [TOTP, SMS])
    const consoleErrors: string[] = []
    page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text()))
    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e}`))
    await page.goto(OVERVIEW, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='mfa-overview'][data-state='loaded']")).toBeVisible()
    const text = await page.locator('body').innerText()
    for (const v of FORBIDDEN_VENDORS) expect(text).not.toContain(v)
    expect(consoleErrors.filter(e => !KNOWN_SHELL_NOISE_RE.test(e))).toEqual([])
  })
})
