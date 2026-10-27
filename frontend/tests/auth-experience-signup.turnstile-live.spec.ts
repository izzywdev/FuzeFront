/**
 * AUTH EXPERIENCE SIGNUP — REAL Cloudflare Turnstile widget with Cloudflare's published TEST keys.
 *
 * The main spec (`auth-experience-signup.spec.ts`) drives a deterministic stub of
 * `window.turnstile`. This spec closes the remaining gap: the REAL
 * `challenges.cloudflare.com/turnstile/v0/api.js` + `@marsidev/react-turnstile` wiring, so a
 * regression in the wrapper/CSP/script-load path is caught.
 *
 *   1x00000000000000000000AA  always passes   (visible widget)       -> token XXXX.DUMMY.TOKEN.XXXX
 *   2x00000000000000000000AB  always fails    (visible widget)
 *   3x00000000000000000000FF  forces an interactive challenge
 *
 * REQUIRES outbound HTTPS to challenges.cloudflare.com, which the CI / sandbox networks used
 * for the mocked-transport suite do not always have. It therefore runs ONLY when
 * `TURNSTILE_LIVE=1` is set (e.g. the nightly / post-prod job with egress). When unset the
 * tests are reported as SKIPPED with that reason — a flagged gap, not a pass.
 *
 *   TURNSTILE_LIVE=1 BASE_URL=http://127.0.0.1:5173 npx playwright test auth-experience-signup.turnstile-live
 */
import { test, expect } from '@playwright/test'
import {
  boot,
  onSignup,
  json,
  STRONG,
  SIGNUP_OK,
  TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_TEST_SITE_KEY_FAIL,
  TURNSTILE_TEST_TOKEN,
} from './support/auth-signup'

test.skip(
  !process.env.TURNSTILE_LIVE,
  'needs outbound HTTPS to challenges.cloudflare.com (set TURNSTILE_LIVE=1 where egress exists)',
)

test.use({ serviceWorkers: 'block' })

test.describe('real Turnstile widget (Cloudflare TEST keys)', () => {
  test('always-pass TEST key: real widget reaches verified and the dummy token is sent on signup', async ({ page }) => {
    const h = await boot(page, { flag: true, methods: { captcha: true, siteKey: TURNSTILE_TEST_SITE_KEY } })
    await onSignup(page, h, r => {
      h.authed = true
      return json(r, 201, SIGNUP_OK)
    })
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.locator('#fzf-signup-email').fill('ada@lovelace.io')
    await page.locator('#fzf-signup-password').fill(STRONG)
    await page.locator('#fzf-signup-confirm').fill(STRONG)
    await expect(page.locator('[data-turnstile]')).toHaveAttribute('data-state', 'verified', { timeout: 30_000 })
    await page.locator("[data-form='signup'] [data-action='submit']").click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0].turnstileToken).toBe(TURNSTILE_TEST_TOKEN)
    expect(h.problems.filter(p => /csp|content security policy|mixed content/i.test(p))).toEqual([])
  })

  test('always-fail TEST key: real widget ends in the failed state and submit stays blocked', async ({ page }) => {
    await boot(page, { flag: true, methods: { captcha: true, siteKey: TURNSTILE_TEST_SITE_KEY_FAIL } })
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.locator('#fzf-signup-email').fill('ada@lovelace.io')
    await page.locator('#fzf-signup-password').fill(STRONG)
    await page.locator('#fzf-signup-confirm').fill(STRONG)
    await expect(page.locator('[data-turnstile]')).toHaveAttribute('data-state', 'failed', { timeout: 30_000 })
    await expect(page.locator("[data-form='signup'] [data-action='submit']")).toBeDisabled()
  })
})
