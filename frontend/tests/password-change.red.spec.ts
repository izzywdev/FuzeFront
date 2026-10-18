/**
 * PASSWORD RESET / CHANGE / SET — TDD RED UI e2e (FFRNT-140).
 *
 * Derived STRICTLY from the frames in design/frames/password-reset/ (manifest
 * testHooks) and the frozen API contract packages/security/openapi.yaml:
 *   POST /v1/security/session/password/reset-request  -> 202 ALWAYS (no enumeration)
 *   POST /v1/security/session/password/reset-confirm  -> 200 {reset:true} | 400
 *   POST /v1/security/password                        -> 200 IdentityConnections | 409 | 400
 *   GET  /v1/security/identity/connections            -> { providers[], hasPassword }
 *
 * Flows covered: change-password + set-password (ChangePasswordFlow / SetPasswordFlow,
 * /account/security/password). The unauthenticated /reset flow is owned by
 * @fuzefront/auth-ui (auth-experience frames/specs), not mounted or tested here.
 *
 * Release flag `fuzefront.account-security.password-reset` (default OFF) is
 * forced ON by mocking GET /api/flags; a "flag OFF" test asserts the surface
 * stays dark.
 *
 * Selectors are ONLY the data-* hooks the frames declare. They are RED until
 * the frames are approved, the package components land and the host routes are
 * mounted; they are deliberately NOT test.skip.
 *
 * Run: BASE_URL=http://fuzefront.dev.local npx playwright test password-change.red
 */
import { test, expect, type Page } from '@playwright/test'
import { installShellMocks, KNOWN_SHELL_NOISE_RE, seedAuth } from './support/mock-shell'

const PASSWORD_ROUTE = '/account/security/password'
const FLAG = 'fuzefront.account-security.password-reset'
const FORBIDDEN_VENDORS = ['Authentik', 'authentik', 'Permit', 'permit.io']
const STRONG = 'Correct-Horse-Battery-9!'

/** Authenticated browser session + the shell's boot mocks (support/mock-shell.ts). */
async function seedSession(page: Page) {
  await seedAuth(page)
}

async function mockFlags(page: Page, on: boolean) {
  await installShellMocks(page, { [FLAG]: on, 'fuzefront.account-security.hub': true })
}

async function mockConnections(page: Page, hasPassword: boolean | null) {
  await page.route('**/v1/security/identity/connections', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ providers: [{ provider: 'google', linked: true }], hasPassword }),
    }),
  )
}

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

test.describe('Password — flag gating (default OFF)', () => {
  test('flag OFF: the password surface is not exposed', async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, false)
    await mockConnections(page, true)
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-frame='05-signed-in']")).toHaveCount(0)
    await expect(page.locator("[data-variant='change']")).toHaveCount(0)
  })
})

test.describe('Password — change (frame 05-signed-in, variant change)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
    await mockConnections(page, true)
  })

  test('renders the change form with current/new/confirm fields, meter and forgot link', async ({ page }) => {
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    const form = page.locator("[data-variant='change'][data-has-password='true']")
    await expect(form).toBeVisible()
    await expect(form.locator("[data-input='current-password']")).toBeVisible()
    await expect(form.locator("[data-input='new-password']")).toBeVisible()
    await expect(form.locator("[data-input='confirm-password']")).toBeVisible()
    await expect(form.locator("[data-nav='forgot']")).toBeVisible()
    await form.locator("[data-input='new-password']").fill('hunter2hunter2')
    await expect(form.locator('[data-meter]')).toBeVisible()
  })

  test('wrong current password -> inline field error, password unchanged (400 INVALID_CREDENTIALS)', async ({ page }) => {
    await page.route('**/v1/security/password/change', route =>
      route.fulfill(json(400, { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })),
    )
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    const form = page.locator("[data-variant='change']")
    await form.locator("[data-input='current-password']").fill('not-my-password')
    await form.locator("[data-input='new-password']").fill(STRONG)
    await form.locator("[data-input='confirm-password']").fill(STRONG)
    await form.locator("[data-action='change-password']").click()
    await expect(page.locator("[data-error='wrong-current']")).toBeVisible()
    await expect(page.locator("[data-field-error='current-password']")).toBeVisible()
  })

  test('policy rejection (400) shows the password-policy field error', async ({ page }) => {
    await page.route('**/v1/security/password/change', route =>
      route.fulfill(json(400, { error: 'Password too common', code: 'MALFORMED' })),
    )
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    const form = page.locator("[data-variant='change']")
    await form.locator("[data-input='current-password']").fill('old-password-1!')
    await form.locator("[data-input='new-password']").fill(STRONG)
    await form.locator("[data-input='confirm-password']").fill(STRONG)
    await form.locator("[data-action='change-password']").click()
    await expect(page.locator("[data-error='password-policy']")).toBeVisible()
    await expect(page.locator("[data-field-error='new-password']")).toBeVisible()
  })

  test('mismatched confirmation blocks submit client-side (no request sent)', async ({ page }) => {
    let called = false
    await page.route('**/v1/security/password/change', route => {
      called = true
      return route.fulfill(json(200, { hasPassword: true, providers: [] }))
    })
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    const form = page.locator("[data-variant='change']")
    await form.locator("[data-input='current-password']").fill('old-password-1!')
    await form.locator("[data-input='new-password']").fill(STRONG)
    await form.locator("[data-input='confirm-password']").fill(STRONG + 'x')
    await form.locator("[data-action='change-password']").click()
    await expect(page.locator("[data-field-error='confirm-password']")).toBeVisible()
    expect(called).toBe(false)
  })

  test('generic failure shows retry, then succeeds', async ({ page }) => {
    let n = 0
    await page.route('**/v1/security/password/change', route => {
      n += 1
      return n === 1
        ? route.fulfill(json(500, { error: 'boom' }))
        : route.fulfill(json(200, { hasPassword: true, providers: [] }))
    })
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    const form = page.locator("[data-variant='change']")
    await form.locator("[data-input='current-password']").fill('old-password-1!')
    await form.locator("[data-input='new-password']").fill(STRONG)
    await form.locator("[data-input='confirm-password']").fill(STRONG)
    await form.locator("[data-action='change-password']").click()
    await expect(page.locator("[data-state='error']")).toBeVisible()
    await page.locator("[data-action='retry']").click()
    await expect(page.locator("[data-state='success']")).toBeVisible()
  })
})

test.describe('Password — set first password (frame 05-signed-in variant set; 06-states 409)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
  })

  test('hasPassword:false renders the set variant with NO current-password field', async ({ page }) => {
    await mockConnections(page, false)
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    const form = page.locator("[data-variant='set'][data-has-password='false']")
    await expect(form).toBeVisible()
    await expect(form.locator("[data-input='set-password']")).toBeVisible()
    await expect(form.locator("[data-input='set-confirm']")).toBeVisible()
    await expect(page.locator("[data-input='current-password']")).toHaveCount(0)
  })

  test('setting a password posts POST /password and confirms success', async ({ page }) => {
    await mockConnections(page, false)
    let body: unknown
    await page.route('**/v1/security/password', route => {
      body = route.request().postDataJSON()
      return route.fulfill(json(200, { providers: [{ provider: 'google', linked: true }], hasPassword: true }))
    })
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    const form = page.locator("[data-variant='set']")
    await form.locator("[data-input='set-password']").fill(STRONG)
    await form.locator("[data-input='set-confirm']").fill(STRONG)
    await form.locator("[data-action='set-password']").click()
    await expect(page.locator("[data-state='success']")).toBeVisible()
    expect(body).toEqual({ newPassword: STRONG })
  })

  test('409 (a password already exists) routes to change / reset instead of crashing', async ({ page }) => {
    await mockConnections(page, false)
    await page.route('**/v1/security/password', route =>
      route.fulfill(json(409, { error: 'Password already set', code: 'CONFLICT' })),
    )
    const errors: string[] = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    const form = page.locator("[data-variant='set']")
    await form.locator("[data-input='set-password']").fill(STRONG)
    await form.locator("[data-input='set-confirm']").fill(STRONG)
    await form.locator("[data-action='set-password']").click()
    await expect(page.locator("[data-state='already-has-password']")).toBeVisible()
    await expect(page.locator("[data-error='password-exists']")).toBeVisible()
    await expect(page.locator("[data-action='go-change']")).toBeVisible()
    await expect(page.locator("[data-action='go-reset']")).toBeVisible()
    expect(errors).toEqual([])
  })

  test('hasPassword:null fails closed — neither variant is offered until connections load', async ({ page }) => {
    await mockConnections(page, null)
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-variant='change']")).toHaveCount(0)
    await expect(page.locator("[data-variant='set']")).toHaveCount(0)
    await expect(page.locator("[data-state='error']")).toBeVisible()
  })
})

test.describe('Password — product boundary + console gate', () => {
  test('no identity-vendor name reaches the DOM; console is clean', async ({ page }) => {
    await seedSession(page)
    await mockFlags(page, true)
    await mockConnections(page, false)
    const consoleErrors: string[] = []
    page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text()))
    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e}`))
    await page.goto(PASSWORD_ROUTE, { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-variant='set']")).toBeVisible()
    const text = await page.locator('body').innerText()
    for (const v of FORBIDDEN_VENDORS) expect(text).not.toContain(v)
    expect(consoleErrors.filter(e => !KNOWN_SHELL_NOISE_RE.test(e))).toEqual([])
  })
})
