/**
 * MFA STEP-UP + CONTACT VERIFICATION, MOBILE (375px) — TDD RED UI e2e (FFRNT-362).
 *
 * Derived STRICTLY from design/frames/mfa-stepup-mobile/ (manifest testHooks) and
 * packages/security/openapi.yaml:
 *   POST /v1/security/mfa/challenge, /mfa/verify        (step-up, /login/mfa, pre-auth)
 *   POST /v1/security/verify/phone/start  -> 202 | 4xx/5xx
 *   POST /v1/security/verify/phone/confirm -> 200 VerificationStatus | 400
 *   GET  /v1/security/verify/status       -> { emailVerified, phoneVerified, phone? }
 *   GET  /v1/security/mfa/factors, DELETE /v1/security/mfa/factors/{id} (409 remove-last)
 *
 * Flows: mfa-stepup-mobile, confirm-contact-phone, security-status-mobile.
 * Release flag `fuzefront.security.mfa-stepup-mobile` (default OFF). The step-up
 * is pre-auth (window.__FF_FLAGS__ override); the account surfaces use /api/flags.
 * Every test runs at a 375x812 viewport. Shares OtpInput/FactorPicker with
 * mfa-management (reconciliation notes in the frames' index).
 *
 * Run: BASE_URL=http://fuzefront.dev.local npx playwright test mfa-stepup-mobile.red
 */
import { test, expect, type Page } from '@playwright/test'
import { installShellMocks, seedAuth } from './support/mock-shell'
import { readActiveAuthToken } from './support/account-vault'

const FLAG = 'fuzefront.security.mfa-stepup-mobile'
const FORBIDDEN_VENDORS = ['Authentik', 'authentik', 'Permit', 'permit.io']

test.use({ viewport: { width: 375, height: 812 } })

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const TOTP = { factorId: 'fct_totp_1', type: 'totp', status: 'active', label: 'Authenticator app' }
const SMS = { factorId: 'fct_sms_1', type: 'sms', status: 'active', label: '•••• •• 4471' }

async function seedSession(page: Page) {
  await seedAuth(page)
}
async function mockFlags(page: Page, on: boolean) {
  await installShellMocks(page, { [FLAG]: on, 'fuzefront.account-security.hub': true })
}
async function preAuthFlag(page: Page, on: boolean) {
  await page.addInitScript(
    ([flag, value]) => {
      const w = window as unknown as { __FF_FLAGS__: Record<string, boolean> }
      w.__FF_FLAGS__ = { [flag as string]: value as boolean }
    },
    [FLAG, on],
  )
}
const methodsBody = (types: string[]) => ({
  password: true, social: [], mfa: { enabled: true, types }, verification: { email: true, sms: types.includes('sms') },
})

async function signInToChallenge(
  page: Page,
  factors: Array<{ factorId: string; type: string }>,
  flagOn = true,
) {
  await preAuthFlag(page, flagOn)
  await page.route('**/v1/security/methods', route => route.fulfill(json(200, methodsBody(['totp', 'sms']))))
  await page.route('**/v1/security/session', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill(json(200, { status: 'mfa_required', challengeId: 'chl_1', factors }))
    }
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

/** Every OTP cell must be fully inside the viewport AND inside the OTP group (no clipping / overflow). */
async function expectOtpCellsUnclipped(page: Page, minCell = 44) {
  const group = page.locator("[data-component='otp-input']")
  const g = await group.boundingBox()
  const vw = page.viewportSize()?.width ?? 375
  const cells = group.locator('input')
  expect(await cells.count()).toBe(6)
  for (let i = 0; i < 6; i += 1) {
    const b = await cells.nth(i).boundingBox()
    expect(b, `cell ${i + 1} has a box`).not.toBeNull()
    expect(b!.x, `cell ${i + 1} left edge`).toBeGreaterThanOrEqual(0)
    expect(b!.x + b!.width, `cell ${i + 1} right edge inside viewport`).toBeLessThanOrEqual(vw)
    expect(b!.x + b!.width, `cell ${i + 1} right edge inside its container`).toBeLessThanOrEqual(g!.x + g!.width + 0.5)
    expect(b!.width, `cell ${i + 1} stays a >=${minCell}px tap target`).toBeGreaterThanOrEqual(minCell)
  }
  const overflow = await group.evaluate(el => el.scrollWidth > el.clientWidth)
  expect(overflow).toBe(false)
}

test.describe('Step-up, choose a factor (frame 01-choose-factor)', () => {
  test('EVERY flag OFF: a server mfa_required still renders the (desktop) step-up, never the mobile one or a dead end', async ({ page }) => {
    await signInToChallenge(page, [{ factorId: 'fct_totp_1', type: 'totp' }], false)
    await expect(page.locator("[data-component='mfa-challenge']")).toBeVisible()
    await expect(page.locator("[data-panel='choose-factor']")).toHaveCount(0)
    await expect(page.locator("[data-component='otp-input'] input")).toHaveCount(6)
    // Flag OFF renders the DESKTOP cells (nominal 40px) inside the 400px login card at 375px:
    // the hosted step-up is flush and the cells shrink to fit — no clipped last cell.
    await expectOtpCellsUnclipped(page, 32)
  })

  test('loaded: only the enrolled factors the server lists (email / sms only when offered)', async ({ page }) => {
    await signInToChallenge(page, [
      { factorId: 'fct_totp_1', type: 'totp' },
      { factorId: 'fct_email_1', type: 'email' },
      { factorId: 'fct_sms_1', type: 'sms' },
    ])
    const panel = page.locator("[data-panel='choose-factor'][data-state='loaded']")
    await expect(panel).toBeVisible()
    await expect(panel.locator("[data-component='factor-picker']")).toBeVisible()
    for (const f of ['totp', 'email', 'sms']) {
      await expect(panel.locator(`[data-factor='${f}']`)).toBeVisible()
    }
    // HONEST DEGRADE: the frame also draws a "Recovery code" row, but the Security contract has
    // no recovery-code step-up operation yet, so it is not offered (recoveryEnabled defaults OFF).
    await expect(panel.locator("[data-factor='recovery']")).toHaveCount(0)
  })

  test('touch targets are at least 44px tall at 375px', async ({ page }) => {
    await signInToChallenge(page, [{ factorId: 'fct_totp_1', type: 'totp' }])
    const box = await page.locator("[data-factor='totp'][data-action='challenge']").boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  test('zero factors returned fails closed to support — never a dead end, never a guess', async ({ page }) => {
    await signInToChallenge(page, [])
    await expect(page.locator("[data-panel='choose-factor'][data-state='empty']")).toBeVisible()
    await expect(page.locator("[data-action='contact-support']")).toBeVisible()
    await expect(page.locator("[data-component='otp-input']")).toHaveCount(0)
  })
})

test.describe('Step-up, enter code (frame 02-enter-code)', () => {
  test.beforeEach(async ({ page }) => {
    // Echo the factor that was actually requested (not a fixed id).
    await page.route('**/v1/security/mfa/challenge', route => {
      const req = route.request().postDataJSON() as { challengeId: string; factorId: string }
      return route.fulfill(json(202, { challengeId: req.challengeId, factorId: req.factorId, delivered: true }))
    })
  })

  test('verify button disables while in flight (no double-submit)', async ({ page }) => {
    let calls = 0
    await page.route('**/v1/security/mfa/verify', async route => {
      calls += 1
      await new Promise(r => setTimeout(r, 600))
      return route.fulfill(json(401, { error: 'Invalid code', code: 'INVALID_CREDENTIALS' }))
    })
    await signInToChallenge(page, [{ factorId: 'fct_totp_1', type: 'totp' }])
    await page.locator("[data-factor='totp'][data-action='challenge']").click()
    await page.locator("[data-component='otp-input'] input").first().click()
    await page.keyboard.type('123456')
    const verify = page.locator("[data-action='verify-mfa']")
    await verify.click()
    await expect(page.locator("[data-panel='enter-code'][data-state='verifying']")).toBeVisible()
    await expect(verify).toBeDisabled()
    await expect(page.locator("[data-panel='enter-code'][data-state='error-invalid']")).toBeVisible()
    expect(calls).toBe(1)
  })

  test('wrong / expired code stays on screen with an inline error', async ({ page }) => {
    await page.route('**/v1/security/mfa/verify', route =>
      route.fulfill(json(401, { error: 'Invalid code', code: 'INVALID_CREDENTIALS' })),
    )
    await signInToChallenge(page, [{ factorId: 'fct_totp_1', type: 'totp' }])
    await page.locator("[data-factor='totp'][data-action='challenge']").click()
    await page.locator("[data-component='otp-input'] input").first().click()
    await page.keyboard.type('000000')
    await page.locator("[data-action='verify-mfa']").click()
    await expect(page.locator("[data-error='invalid-code']")).toBeVisible()
    expect(page.url()).toContain('/login')
  })

  test('SMS code sent: expiry countdown + resend disabled during cooldown', async ({ page }) => {
    await signInToChallenge(page, [{ factorId: 'fct_sms_1', type: 'sms' }])
    await page.locator("[data-factor='sms'][data-action='challenge']").click()
    await expect(page.locator("[data-value='expires-in']")).toBeVisible()
    await expect(page.locator("[data-state='cooldown']")).toBeVisible()
    await expect(page.locator("[data-state='cooldown'] [data-action='resend']")).toHaveAttribute('aria-disabled', 'true')
  })

  test('delivery failure offers resend + other methods', async ({ page }) => {
    await page.unroute('**/v1/security/mfa/challenge')
    await page.route('**/v1/security/mfa/challenge', route =>
      route.fulfill(json(503, { error: 'Delivery failed', code: 'PROVIDER_UNAVAILABLE' })),
    )
    await signInToChallenge(page, [{ factorId: 'fct_sms_1', type: 'sms' }])
    await page.locator("[data-factor='sms'][data-action='challenge']").click()
    await expect(page.locator("[data-panel='enter-code'][data-state='error-delivery']")).toBeVisible()
    await expect(page.locator("[data-action='challenge']")).toBeVisible()
    await expect(page.locator("[data-action='choose-factor']")).toBeVisible()
  })

  test('NO OTP cell is clipped at 375px: all six 44px cells sit inside the viewport and their container', async ({ page }) => {
    await signInToChallenge(page, [{ factorId: 'fct_totp_1', type: 'totp' }])
    await page.locator("[data-factor='totp'][data-action='challenge']").click()
    await expectOtpCellsUnclipped(page)
  })

  test('a correct code: POSTs the real ids + code, persists the session and lands on the dashboard', async ({ page }) => {
    await installShellMocks(page, { [FLAG]: true })
    let verifyBody: unknown
    await page.route('**/v1/security/mfa/verify', route => {
      verifyBody = route.request().postDataJSON()
      return route.fulfill(json(200, { token: 'tok_ok', sessionId: 'sess_ok', user: { id: 'usr-e2e-1', email: 'amara@rowan.co' } }))
    })
    await signInToChallenge(page, [{ factorId: 'fct_totp_1', type: 'totp' }])
    // After sign-in the app hydrates the user via GET /session; the POST keeps the earlier handler.
    await page.route('**/v1/security/session', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill(json(200, { user: { id: 'usr-e2e-1', email: 'amara@rowan.co', roles: ['user'], firstName: 'Amara', lastName: 'Rowan' } }))
      }
      return route.fallback()
    })
    await page.locator("[data-factor='totp'][data-action='challenge']").click()
    await page.locator("[data-component='otp-input'] input").first().click()
    await page.keyboard.type('123456')
    await page.locator("[data-action='verify-mfa']").click()
    await page.waitForURL('**/dashboard')
    expect(verifyBody).toEqual({ challengeId: 'chl_1', factorId: 'fct_totp_1', code: '123456' })
    // The shell may reload while booting the dashboard; read the vault once it settles.
    await expect(async () => {
      expect(await page.evaluate(readActiveAuthToken)).toBe('tok_ok')
    }).toPass()
  })

  test('OTP cells are touch sized (>= 44px)', async ({ page }) => {
    await signInToChallenge(page, [{ factorId: 'fct_totp_1', type: 'totp' }])
    await page.locator("[data-factor='totp'][data-action='challenge']").click()
    const box = await page.locator("[data-component='otp-input'] input").first().boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })
})

test.describe('Confirm phone (frame 03-confirm-contact)', () => {
  const ROUTE = '/account/security/verify/phone'
  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
  })

  test('enter phone -> send code -> enter code -> verified (asserts the start + confirm request bodies)', async ({ page }) => {
    let startBody: unknown
    let confirmBody: unknown
    await page.route('**/v1/security/verify/phone/start', route => {
      startBody = route.request().postDataJSON()
      return route.fulfill({ status: 202 })
    })
    await page.route('**/v1/security/verify/phone/confirm', route => {
      confirmBody = route.request().postDataJSON()
      return route.fulfill(json(200, { emailVerified: true, phoneVerified: true, phone: '+15550000000' }))
    })
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='confirm-contact'][data-state='enter-phone']")).toBeVisible()
    await page.locator('#phone, input[inputmode="tel"]').first().fill('+1 555 000 0000')
    await page.locator("[data-action='send-code']").click()
    await expect(page.locator("[data-panel='confirm-contact'][data-state='enter-code']")).toBeVisible()
    await page.locator("[data-component='otp-input'] input").first().click()
    await page.keyboard.type('123456')
    await expect(async () => {
      await expectOtpCellsUnclipped(page)
    }).toPass()
    await page.locator("[data-action='verify-contact']").click()
    await expect(page.locator("[data-panel='confirm-contact'][data-state='verified']")).toBeVisible()
    expect(startBody).toEqual({ phone: '+1 555 000 0000' })
    expect(confirmBody).toEqual({ phone: '+1 555 000 0000', code: '123456' })
  })

  test('wrong / expired code (400): inline error, no navigation', async ({ page }) => {
    await page.route('**/v1/security/verify/phone/start', route => route.fulfill({ status: 202 }))
    // Real backend: a wrong / expired code is 401 (the contract also allows 400).
    await page.route('**/v1/security/verify/phone/confirm', route =>
      route.fulfill(json(401, { error: 'invalid or expired code', code: 'NOT_ACTIVE' })),
    )
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await page.locator('#phone, input[inputmode="tel"]').first().fill('+1 555 000 0000')
    await page.locator("[data-action='send-code']").click()
    await page.locator("[data-component='otp-input'] input").first().click()
    await page.keyboard.type('000000')
    await page.locator("[data-action='verify-contact']").click()
    await expect(page.locator("[data-panel='confirm-contact'][data-state='error-invalid']")).toBeVisible()
    await expect(page.locator("[data-error='invalid-code']")).toBeVisible()
    expect(page.url()).toContain(ROUTE)
  })

  test('generic send failure offers retry or skip — never a silent hang', async ({ page }) => {
    await page.route('**/v1/security/verify/phone/start', route => route.fulfill(json(500, { error: 'boom' })))
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await page.locator('#phone, input[inputmode="tel"]').first().fill('+1 555 000 0000')
    await page.locator("[data-action='send-code']").click()
    await expect(page.locator("[data-panel='confirm-contact'][data-state='error-send']")).toBeVisible()
    await expect(page.locator("[data-action='send-code']")).toBeVisible()
    await expect(page.locator("[data-action='skip']")).toBeVisible()
  })

  test('skip is always available', async ({ page }) => {
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-action='skip']").first()).toBeVisible()
  })
})

test.describe('Security status, mobile (frame 04-security-status)', () => {
  const ROUTE = '/account/security'
  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
    await page.route('**/v1/security/methods', route => route.fulfill(json(200, methodsBody(['totp', 'sms']))))
    await page.route('**/v1/security/identity/connections', route =>
      route.fulfill(json(200, { providers: [], hasPassword: true })),
    )
  })

  test('flag OFF: unchanged hub, no mobile status panel', async ({ page }) => {
    await mockFlags(page, false)
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='security-status']")).toHaveCount(0)
  })

  test('loaded: factor chips Active + contact chips Verified/Unverified', async ({ page }) => {
    await page.route('**/v1/security/mfa/factors', route => route.fulfill(json(200, { items: [TOTP, SMS] })))
    await page.route('**/v1/security/verify/status', route =>
      route.fulfill(json(200, { emailVerified: true, phoneVerified: false })),
    )
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    const panel = page.locator("[data-panel='security-status'][data-state='loaded']")
    await expect(panel).toBeVisible()
    await expect(panel.locator("[data-status='active']").first()).toBeVisible()
    await expect(panel.locator("[data-status='verified']")).toBeVisible()
    await expect(panel.locator("[data-status='unverified']")).toBeVisible()
    await expect(panel.locator("[data-action='verify-phone']")).toBeVisible()
  })

  test('"Add a method" is hidden (explained) while mfa-management is OFF, offered when ON', async ({ page }) => {
    await page.route('**/v1/security/mfa/factors', route => route.fulfill(json(200, { items: [TOTP] })))
    await page.route('**/v1/security/verify/status', route =>
      route.fulfill(json(200, { emailVerified: true, phoneVerified: true })),
    )
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='security-status'][data-state='loaded']")).toBeVisible()
    await expect(page.locator("[data-panel='security-status'] [data-action='add-factor']")).toHaveCount(0)
    await expect(page.locator("[data-state='add-unavailable']")).toBeVisible()
  })

  test('mfa-management ON: "Add a method" is offered', async ({ page }) => {
    await installShellMocks(page, { [FLAG]: true, 'fuzefront.security.mfa-management': true, 'fuzefront.account-security.hub': true })
    await page.route('**/v1/security/mfa/factors', route => route.fulfill(json(200, { items: [TOTP] })))
    await page.route('**/v1/security/verify/status', route =>
      route.fulfill(json(200, { emailVerified: true, phoneVerified: true })),
    )
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='security-status'] [data-action='add-factor']")).toBeVisible()
  })

  test('error: retry, never a stale guess', async ({ page }) => {
    await page.route('**/v1/security/mfa/factors', route => route.fulfill(json(500, { error: 'boom' })))
    await page.route('**/v1/security/verify/status', route => route.fulfill(json(500, { error: 'boom' })))
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='security-status'][data-state='error']")).toBeVisible()
    await expect(page.locator("[data-action='retry']").first()).toBeVisible()
    await expect(page.locator("[data-status='active']")).toHaveCount(0)
  })

  test('remove the only active factor -> 409 -> bottom-sheet blocks removal', async ({ page }) => {
    await page.route('**/v1/security/mfa/factors', route => route.fulfill(json(200, { items: [TOTP] })))
    await page.route('**/v1/security/verify/status', route =>
      route.fulfill(json(200, { emailVerified: true, phoneVerified: true })),
    )
    await page.route('**/v1/security/mfa/factors/*', route => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill(json(409, { error: 'Two-factor is required', code: 'LAST_FACTOR' }))
      }
      return route.fallback()
    })
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await page.locator("[data-panel='security-status'] [data-action='remove-factor']").click()
    // confirm step inside the sheet, then the server's 409 decides
    const confirm = page.locator("[data-component='remove-factor-dialog'] [data-action='remove-confirm']")
    if (await confirm.count()) await confirm.click()
    const blocked = page.locator("[data-component='remove-factor-dialog'][data-state='remove-last-blocked']")
    await expect(blocked).toBeVisible()
    await expect(blocked).toHaveAttribute('data-http-status', '409')
    await expect(blocked.locator("[data-error='remove-last']")).toBeVisible()
    await expect(page.locator("[data-panel='security-status'] [data-factor='totp']")).toBeVisible()
  })

  test('status shows only confirmed server state, no vendor names, fits the 375px viewport', async ({ page }) => {
    await page.route('**/v1/security/mfa/factors', route => route.fulfill(json(200, { items: [TOTP] })))
    await page.route('**/v1/security/verify/status', route =>
      route.fulfill(json(200, { emailVerified: false, phoneVerified: false })),
    )
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-panel='security-status']")).toBeVisible()
    const text = await page.locator('body').innerText()
    for (const v of FORBIDDEN_VENDORS) expect(text).not.toContain(v)
    // The status panel itself must fit the 375px viewport. (Page-level horizontal overflow
    // today comes from the host shell's top-bar actions — a pre-existing mobile-shell issue
    // outside this panel — so the assertion is scoped to the panel.)
    const box = await page.locator("[data-panel='security-status']").boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375)
  })
})
