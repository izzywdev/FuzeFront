/**
 * AUTH EXPERIENCE (verify-email + password-reset) — RED-by-design UI e2e. (FFRNT-360)
 *
 * Derived STRICTLY from the approved frames:
 *   design/frames/auth-experience/manifest.json   (flows verify-email / password-reset, approved 2026-07-21)
 *   design/frames/auth-experience/03-check-inbox.html     /signup/verify
 *   design/frames/auth-experience/04-verify-landing.html  /verify/email
 *   design/frames/auth-experience/05-password-reset.html  /reset
 *   design/frames/auth-experience/06-states.html          (unverified-gate, rate-limit etc.)
 * and the frozen contract packages/security/openapi.yaml:
 *   POST /v1/security/verify/email/start          -> 202
 *   POST /v1/security/verify/email/confirm        -> 200 VerificationStatus | 400 EXPIRED/INVALID_CODE
 *   POST /v1/security/session/password/reset-request  -> ALWAYS 202 (no enumeration)
 *   POST /v1/security/session/password/reset-confirm  -> 200 { reset:true } | 400
 *
 * The whole experience ships behind `fuzefront.auth.experience` (release flag, default OFF).
 * The unauthenticated shell reads it pre-auth, so these specs force it with the same-origin
 * runtime override `window.__FF_AUTH_EXPERIENCE__` (see isAuthExperienceEnabled()).
 *
 * RED: before the implementation the routes /signup/verify, /verify/email and /reset all fall
 * through to LoginPage, so none of the [data-frame]/[data-form]/[data-state] hooks exist.
 * They are deliberately NOT test.skip/fixme.
 *
 * Selectors are ONLY the frames' data-* hooks (manifest.testHooks).
 *
 * Run: BASE_URL=http://localhost:5173 npx playwright test auth-experience-verify-reset.red
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const SEC = '**/v1/security'
const STRONG = 'Rev0lution-99$x'

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: body === undefined ? '' : JSON.stringify(body),
  })

/** Unauthenticated boot: the session probe answers 401, flag forced ON/OFF pre-auth. */
async function boot(page: Page, flag: boolean) {
  await page.addInitScript(on => {
    ;(window as unknown as { __FF_AUTH_EXPERIENCE__?: boolean }).__FF_AUTH_EXPERIENCE__ = on
  }, flag)
  await page.route(`${SEC}/session`, route =>
    route.request().method() === 'GET'
      ? json(route, 401, { error: 'no token', code: 'NO_TOKEN' })
      : route.fallback(),
  )
  await page.route(`${SEC}/methods`, route =>
    json(route, 200, {
      password: true,
      social: ['google'],
      mfa: { enabled: false, types: [] },
      verification: { email: true, sms: false },
    }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// verify-email · 03-check-inbox  (/signup/verify)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('verify-email — check inbox (frame 03-check-inbox)', () => {
  test.beforeEach(async ({ page }) => boot(page, true))

  test('shows the target email and a disabled resend button during cooldown', async ({ page }) => {
    await page.goto('/signup/verify?email=ada%40lovelace.io', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-frame='03-check-inbox']")).toBeVisible()
    await expect(page.locator("[data-value='email']")).toHaveText('ada@lovelace.io')
    const resend = page.locator("[data-action='resend']")
    await expect(resend).toBeDisabled()
    await expect(resend).toHaveAttribute('data-state', 'cooldown')
  })

  test('resend re-enables after the cooldown and POSTs /verify/email/start (202)', async ({ page }) => {
    let started = 0
    await page.route(`${SEC}/verify/email/start`, route => {
      started++
      return json(route, 202)
    })
    await page.clock.install()
    await page.goto('/signup/verify?email=ada%40lovelace.io', { waitUntil: 'domcontentloaded' })
    const resend = page.locator("[data-action='resend']")
    await expect(resend).toBeDisabled()
    await page.clock.fastForward(61_000)
    await expect(resend).toBeEnabled()
    await resend.click()
    await expect.poll(() => started).toBe(1)
    // cooldown restarts after a successful resend
    await expect(resend).toBeDisabled()
    await expect(resend).toHaveAttribute('data-state', 'cooldown')
  })

  test('429 on resend surfaces a rate-limited message and keeps the button usable later', async ({ page }) => {
    await page.route(`${SEC}/verify/email/start`, route =>
      json(route, 429, { error: 'Too many requests', code: 'RATE_LIMITED' }),
    )
    await page.clock.install()
    await page.goto('/signup/verify?email=ada%40lovelace.io', { waitUntil: 'domcontentloaded' })
    await page.clock.fastForward(61_000)
    await page.locator("[data-action='resend']").click()
    await expect(page.locator("[data-state='rate-limited']")).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// verify-email · 04-verify-landing  (/verify/email?token=…)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('verify-email — link landing (frame 04-verify-landing)', () => {
  test.beforeEach(async ({ page }) => boot(page, true))

  test('verifying (transient) → verified, with a continue action', async ({ page }) => {
    let body: unknown
    await page.route(`${SEC}/verify/email/confirm`, async route => {
      body = route.request().postDataJSON()
      await new Promise(r => setTimeout(r, 400))
      await json(route, 200, { emailVerified: true, phoneVerified: false })
    })
    await page.goto('/verify/email?token=tok_abc', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-frame='04-verify-landing']")).toBeVisible()
    await expect(page.locator("[data-state='verifying']")).toBeVisible()
    await expect(page.locator("[data-state='verified']")).toBeVisible()
    await expect(page.locator("[data-action='continue']")).toBeVisible()
    expect(body).toEqual({ token: 'tok_abc' })
  })

  for (const code of ['EXPIRED', 'INVALID_CODE']) {
    test(`${code} → expired state offering a new link`, async ({ page }) => {
      await page.route(`${SEC}/verify/email/confirm`, route =>
        json(route, 400, { error: 'bad link', code }),
      )
      await page.goto('/verify/email?token=tok_old', { waitUntil: 'domcontentloaded' })
      await expect(page.locator("[data-state='expired']")).toBeVisible()
      await expect(page.locator("[data-action='resend']")).toBeVisible()
    })
  }

  test('a missing token lands on the expired/invalid state without calling the API', async ({ page }) => {
    let called = false
    await page.route(`${SEC}/verify/email/confirm`, route => {
      called = true
      return json(route, 200, { emailVerified: true, phoneVerified: false })
    })
    await page.goto('/verify/email', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-state='expired']")).toBeVisible()
    expect(called).toBe(false)
  })

  test('a transport failure shows a generic error with retry, not a crash', async ({ page }) => {
    await page.route(`${SEC}/verify/email/confirm`, route => route.abort('failed'))
    await page.goto('/verify/email?token=tok_abc', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-state='error']")).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// password-reset · 05-password-reset  (/reset)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('password-reset — request (frame 05-password-reset, step request)', () => {
  test.beforeEach(async ({ page }) => boot(page, true))

  test('renders the request form and the sign-in link', async ({ page }) => {
    await page.goto('/reset', { waitUntil: 'domcontentloaded' })
    await expect(page.locator("[data-frame='05-password-reset']")).toBeVisible()
    await expect(page.locator("[data-step='request']")).toBeVisible()
    await expect(page.locator("[data-form='reset-request']")).toBeVisible()
  })

  test('submit POSTs reset-request and shows the same confirmation for any address (no enumeration)', async ({ page }) => {
    const seen: unknown[] = []
    await page.route(`${SEC}/session/password/reset-request`, route => {
      seen.push(route.request().postDataJSON())
      return json(route, 202)
    })
    const copies: string[] = []
    for (const email of ['ada@lovelace.io', 'nobody@nowhere.example']) {
      await page.goto('/reset', { waitUntil: 'domcontentloaded' })
      await page.locator("[data-form='reset-request'] input[name='email']").fill(email)
      await page.locator("[data-form='reset-request'] [data-action='submit']").click()
      const sent = page.locator("[data-step='request-sent']")
      await expect(sent).toBeVisible()
      copies.push((await sent.innerText()).replace(email, '<email>'))
    }
    expect(seen).toEqual([{ email: 'ada@lovelace.io' }, { email: 'nobody@nowhere.example' }])
    expect(copies[0]).toBe(copies[1])
  })

  test('request-sent has a resend button on a cooldown', async ({ page }) => {
    await page.route(`${SEC}/session/password/reset-request`, route => json(route, 202))
    await page.goto('/reset', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-form='reset-request'] input[name='email']").fill('ada@lovelace.io')
    await page.locator("[data-form='reset-request'] [data-action='submit']").click()
    await expect(page.locator("[data-step='request-sent'] [data-action='resend']")).toBeDisabled()
  })

  test('429 shows a rate-limited message; the form stays', async ({ page }) => {
    await page.route(`${SEC}/session/password/reset-request`, route =>
      json(route, 429, { error: 'Too many requests', code: 'RATE_LIMITED' }),
    )
    await page.goto('/reset', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-form='reset-request'] input[name='email']").fill('ada@lovelace.io')
    await page.locator("[data-form='reset-request'] [data-action='submit']").click()
    await expect(page.locator("[data-state='rate-limited']")).toBeVisible()
    await expect(page.locator("[data-form='reset-request']")).toBeVisible()
  })

  test('a generic failure shows an error and keeps the form', async ({ page }) => {
    await page.route(`${SEC}/session/password/reset-request`, route => route.abort('failed'))
    await page.goto('/reset', { waitUntil: 'domcontentloaded' })
    await page.locator("[data-form='reset-request'] input[name='email']").fill('ada@lovelace.io')
    await page.locator("[data-form='reset-request'] [data-action='submit']").click()
    await expect(page.locator("[data-state='error']")).toBeVisible()
  })
})

test.describe('password-reset — confirm (frame 05-password-reset, steps confirm / confirm-expired)', () => {
  test.beforeEach(async ({ page }) => boot(page, true))

  const confirmForm = "[data-form='reset-confirm']"

  test('?token= opens the confirm form; mismatch disables submit and flags data-match=false', async ({ page }) => {
    await page.goto('/reset?token=rst_123', { waitUntil: 'domcontentloaded' })
    await expect(page.locator(confirmForm)).toBeVisible()
    await page.locator(`${confirmForm} input[name='newPassword']`).fill(STRONG)
    await expect(page.locator('[data-pwmeter]')).toBeVisible()
    await page.locator(`${confirmForm} input[name='confirm']`).fill('Rev0lution-99$')
    await expect(page.locator(`${confirmForm} input[name='confirm']`)).toHaveAttribute('data-match', 'false')
    await expect(page.locator(`${confirmForm} [data-action='submit']`)).toHaveAttribute('aria-disabled', 'true')
  })

  test('a weak password keeps submit disabled even when it matches', async ({ page }) => {
    await page.goto('/reset?token=rst_123', { waitUntil: 'domcontentloaded' })
    await page.locator(`${confirmForm} input[name='newPassword']`).fill('short')
    await page.locator(`${confirmForm} input[name='confirm']`).fill('short')
    await expect(page.locator(`${confirmForm} [data-action='submit']`)).toHaveAttribute('aria-disabled', 'true')
  })

  test('valid + matching password POSTs reset-confirm {token,newPassword} and shows success', async ({ page }) => {
    let body: unknown
    await page.route(`${SEC}/session/password/reset-confirm`, route => {
      body = route.request().postDataJSON()
      return json(route, 200, { reset: true })
    })
    await page.goto('/reset?token=rst_123', { waitUntil: 'domcontentloaded' })
    await page.locator(`${confirmForm} input[name='newPassword']`).fill(STRONG)
    await page.locator(`${confirmForm} input[name='confirm']`).fill(STRONG)
    await expect(page.locator(`${confirmForm} input[name='confirm']`)).toHaveAttribute('data-match', 'true')
    await page.locator(`${confirmForm} [data-action='submit']`).click()
    await expect(page.locator("[data-step='confirm-done']")).toBeVisible()
    expect(body).toEqual({ token: 'rst_123', newPassword: STRONG })
  })

  test('an expired/used token (400) shows confirm-expired; restart returns to the request form', async ({ page }) => {
    await page.route(`${SEC}/session/password/reset-confirm`, route =>
      json(route, 400, { error: 'Password reset failed', code: 'MALFORMED' }),
    )
    await page.goto('/reset?token=rst_used', { waitUntil: 'domcontentloaded' })
    await page.locator(`${confirmForm} input[name='newPassword']`).fill(STRONG)
    await page.locator(`${confirmForm} input[name='confirm']`).fill(STRONG)
    await page.locator(`${confirmForm} [data-action='submit']`).click()
    await expect(page.locator("[data-step='confirm-expired']")).toBeVisible()
    await page.locator("[data-step='confirm-expired'] [data-action='restart']").click()
    await expect(page.locator("[data-form='reset-request']")).toBeVisible()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Entry point + the flag boundary (default OFF = today's behaviour)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('auth experience — entry point and feature flag', () => {
  test('flag ON: sign-in shows a Forgot password? link to /reset', async ({ page }) => {
    await boot(page, true)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    const link = page.getByRole('link', { name: /forgot password/i })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/reset')
  })

  test('flag OFF: no forgot link, and /reset, /verify/email, /signup/verify fall through to the sign-in page', async ({ page }) => {
    await boot(page, false)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('link', { name: /forgot password/i })).toHaveCount(0)
    for (const path of ['/reset', '/verify/email?token=t', '/signup/verify?email=a%40b.co']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('[data-frame], [data-form="reset-request"]')).toHaveCount(0)
    }
  })
})
