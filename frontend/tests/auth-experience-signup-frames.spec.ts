/**
 * APPROVED-FRAMES GATE — auth-experience SIGNUP (flow `signup`, re-approved 2026-10-25).
 *
 * Loads the frozen static frames over file:// (no stack, no server) and asserts the
 * structure each is the source of truth for:
 *   design/frames/auth-experience/01-signup.html   the signup form + its data-* hooks
 *   design/frames/auth-experience/06-states.html   every state card, addressable by data-state
 *   design/frames/auth-experience/manifest.json    approval marker + the declared testHooks
 *
 * These are HTML fixtures, not the React app. The built UI is verified against them by
 * `auth-experience-signup.spec.ts` (hook parity + computed-metric comparison).
 *
 * Run (matches the repo-root frames-gate config `-frames.spec.ts`):
 *   npx playwright test -c playwright.config.ts auth-experience-signup-frames
 */
import { test, expect, type Page } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = fileURLToPath(new URL('.', import.meta.url))
import fs from 'node:fs'

const DIR = path.resolve(HERE, '..', '..', 'design', 'frames', 'auth-experience')
const url = (f: string) => pathToFileURL(path.join(DIR, f)).href
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))

const card = (page: Page, state: string) => page.locator(`.state-card[data-state='${state}']`)

test.describe('manifest — signup flow approval + declared hooks', () => {
  test('the signup flow is approved and the manifest is stamped', () => {
    const flow = manifest.build.flows.find((f: any) => f.id === 'signup')
    expect(flow, 'signup flow declared').toBeTruthy()
    expect(flow.approved).toBe(true)
    expect(flow.approvedBy).toBeTruthy()
    expect(Date.parse(flow.approvedAt)).not.toBeNaN()
    expect(manifest.stamp).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.contract.featureFlag).toBe('fuzefront.auth.experience')
  })

  test('01-signup and 06-states are in the manifest and exist on disk', () => {
    for (const id of ['01-signup', '06-states']) {
      const f = manifest.frames.find((x: any) => x.id === id)
      expect(f, `${id} in manifest`).toBeTruthy()
      expect(fs.existsSync(path.join(DIR, f.file)), `${f.file} on disk`).toBe(true)
    }
  })

  for (const id of ['01-signup', '06-states']) {
    test(`every testHook declared for ${id} resolves in the frame`, async ({ page }) => {
      const f = manifest.frames.find((x: any) => x.id === id)
      await page.goto(url(f.file))
      const missing: string[] = []
      for (const hook of f.testHooks as string[]) {
        if ((await page.locator(hook).count()) === 0) missing.push(hook)
      }
      expect(missing, `${id} hooks missing from the frame`).toEqual([])
    })
  }
})

test.describe('01-signup — structure', () => {
  test.beforeEach(async ({ page }) => page.goto(url('01-signup.html')))

  test('single OPTIONAL full-name field: autocomplete=name, no first/last split, localizable', async ({ page }) => {
    const n = page.locator("[data-field='full-name']")
    await expect(n).toHaveCount(1)
    await expect(n).toHaveAttribute('autocomplete', 'name')
    await expect(n).not.toHaveAttribute('required', /.*/)
    await expect(page.locator('label[for="fullName"] .field__optional')).toHaveText(/optional/i)
    await expect(page.locator('input[name="firstName"], input[name="lastName"]')).toHaveCount(0)
    await expect(page.locator('[data-i18n="auth.signup.fullName.label"]')).toHaveCount(1)
    await expect(page.locator('[data-i18n="auth.signup.fullName.help"]')).toHaveCount(1)
  })

  test('email + availability ✓, password + meter + 5-rule checklist all met, confirm match, Turnstile verified', async ({ page }) => {
    await expect(page.locator("[data-avail='available']")).toBeVisible()
    await expect(page.locator('[data-pwmeter]')).toHaveAttribute('data-strength', 'strong')
    for (const r of ['length', 'upper', 'lower', 'digit', 'symbol']) {
      await expect(page.locator(`[data-pwreq] [data-req='${r}']`)).toHaveAttribute('data-met', 'true')
    }
    await expect(page.locator("[data-match='true']")).toBeVisible()
    await expect(page.locator('[data-turnstile]')).toHaveAttribute('data-state', 'verified')
    await expect(page.locator("[data-form='signup'] [data-action='submit']")).toBeEnabled()
    await expect(page.locator("[data-action='social-google']")).toBeVisible()
    await expect(page.locator("[data-nav='signin']")).toHaveAttribute('href', '02-signin.html')
  })

  test('no vendor identity-provider name in the RENDERED frame (text, attributes, hrefs)', async ({ page }) => {
    // The design source carries a designer HTML *comment* naming the IdP (not rendered, not shipped);
    // what the consumer surface must not expose is rendered text / attribute values.
    const leaked = await page.evaluate(() => {
      const hits: string[] = []
      const re = /authentik/i
      if (re.test(document.body.innerText)) hits.push('text')
      for (const el of Array.from(document.querySelectorAll('*'))) {
        for (const a of Array.from(el.attributes)) if (re.test(a.value)) hits.push(`${el.tagName}[${a.name}]`)
      }
      return hits
    })
    expect(leaked).toEqual([])
  })

  test('control sizes: inputs >=44px tall, submit >=46px, show-password toggle >=24px (the numbers the build is held to)', async ({ page }) => {
    const h = async (sel: string) => (await page.locator(sel).first().boundingBox())!
    expect((await h('#email')).height).toBeGreaterThanOrEqual(44)
    expect((await h('#password')).height).toBeGreaterThanOrEqual(44)
    expect((await h("[data-form='signup'] [data-action='submit']")).height).toBeGreaterThanOrEqual(46)
    const t = await h('.pw-toggle')
    expect(t.width).toBeGreaterThanOrEqual(24)
    expect(t.height).toBeGreaterThanOrEqual(24)
  })

  test('RTL (ar/he): adornments + toggle mirror to the inline-end via logical properties', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl')
      document.documentElement.setAttribute('lang', 'ar')
    })
    const g = await page.evaluate(() => {
      const mid = (el: Element) => {
        const r = el.getBoundingClientRect()
        return r.left + r.width / 2
      }
      const t = document.querySelector('.pw-toggle')!
      const pwd = document.querySelector('#password')!
      const a = document.querySelector('#email')!.parentElement!.querySelector('.input-adornment')!
      return { t: mid(t), pwd: mid(pwd), a: mid(a), email: mid(document.querySelector('#email')!) }
    })
    expect(g.t).toBeLessThan(g.pwd)
    expect(g.a).toBeLessThan(g.email)
  })
})

test.describe('01-signup — responsive', () => {
  for (const [name, w, h] of [
    ['Galaxy S9+', 320, 658],
    ['iPhone SE', 375, 667],
    ['Pixel 5', 393, 851],
    ['iPad Mini', 768, 1024],
    ['Pixel 5 landscape', 851, 393],
  ] as const) {
    test(`${name} (${w}x${h}): no horizontal overflow and the primary actions are reachable`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(url('01-signup.html'))
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(over).toBeLessThanOrEqual(0)
      const submit = page.locator("[data-form='signup'] [data-action='submit']")
      await submit.scrollIntoViewIfNeeded()
      await expect(submit).toBeInViewport()
    })
  }
})

test.describe('06-states — every state card is addressable and shaped as the contract says', () => {
  test.beforeEach(async ({ page }) => page.goto(url('06-states.html')))

  test('all declared state cards are present and visible', async ({ page }) => {
    const states = [
      'email-idle', 'email-checking', 'email-available', 'email-taken', 'email-check-error',
      'signup-initial', 'pw-weak', 'pw-strong', 'confirm-mismatch',
      'turnstile-loading', 'turnstile-verified', 'turnstile-failed',
      'submit-inflight', 'form-error', 'signup-conflict', 'signup-pw-weak-submit',
      'provider-unavailable', 'signup-service-unavailable', 'mfa-required', 'unverified-gate',
    ]
    for (const s of states) await expect(card(page, s), s).toBeVisible()
  })

  test('signup-initial: empty optional name (no error), checklist all unmet, submit disabled', async ({ page }) => {
    const c = card(page, 'signup-initial')
    await expect(c.locator("[data-field='full-name']")).toHaveValue('')
    await expect(c.locator('[data-field="full-name"][aria-invalid="true"]')).toHaveCount(0)
    const reqs = c.locator('[data-pwreq] [data-req]')
    await expect(reqs).toHaveCount(5)
    for (const el of await reqs.all()) await expect(el).toHaveAttribute('data-met', 'false')
    await expect(c.locator("[data-action='submit']")).toBeDisabled()
  })

  test('email availability chips map to data-avail (checking / available / taken / error)', async ({ page }) => {
    await expect(card(page, 'email-checking').locator("[data-avail='checking']")).toBeVisible()
    await expect(card(page, 'email-available').locator("[data-avail='available']")).toBeVisible()
    await expect(card(page, 'email-taken').locator("[data-avail='taken']")).toBeVisible()
    await expect(card(page, 'email-taken').locator("[data-action='signin-instead']")).toHaveAttribute('href', '02-signin.html')
    await expect(card(page, 'email-check-error').locator("[data-avail='error']")).toBeVisible()
    // fail-open copy: the error never blocks
    await expect(card(page, 'email-check-error')).toContainText(/never blocks you/i)
  })

  test('pw-weak: weak meter with only lowercase met; signup-pw-weak-submit: alert + same unmet set', async ({ page }) => {
    const weak = card(page, 'pw-weak')
    await expect(weak.locator('[data-pwmeter]')).toHaveAttribute('data-strength', 'weak')
    await expect(weak.locator("[data-req='lower']")).toHaveAttribute('data-met', 'true')
    for (const r of ['length', 'upper', 'digit', 'symbol']) {
      await expect(weak.locator(`[data-req='${r}']`)).toHaveAttribute('data-met', 'false')
    }
    const post = card(page, 'signup-pw-weak-submit')
    await expect(post.locator('.alert--error')).toContainText("That password doesn't meet our requirements.")
    await expect(post.locator('[data-pwreq]')).toBeVisible()
  })

  test('confirm-mismatch: data-match=false, aria-invalid, inline message', async ({ page }) => {
    const c = card(page, 'confirm-mismatch')
    await expect(c.locator("[data-match='false']")).toHaveAttribute('aria-invalid', 'true')
    await expect(c.locator('.field__error')).toContainText("Passwords don't match yet.")
  })

  test('Turnstile loading / verified / failed (+ please-complete message)', async ({ page }) => {
    await expect(card(page, 'turnstile-loading').locator("[data-state='loading']").first()).toBeVisible()
    await expect(card(page, 'turnstile-verified').locator("[data-state='verified']").first()).toBeVisible()
    const failed = card(page, 'turnstile-failed')
    await expect(failed.locator("[data-state='failed']").first()).toBeVisible()
    await expect(failed.locator('[role="alert"]')).toHaveText('Please complete the challenge to continue.')
  })

  test('submit-inflight: disabled button with spinner', async ({ page }) => {
    const b = card(page, 'submit-inflight').locator("[data-action='submit']")
    await expect(b).toBeDisabled()
    await expect(b.locator('.btn-spinner')).toBeVisible()
    await expect(b).toContainText('Creating account')
  })

  test('signup-conflict (409): sign-in + reset links; signup-service-unavailable: Google fallback + retry', async ({ page }) => {
    const c = card(page, 'signup-conflict')
    await expect(c).toContainText('That account already exists.')
    await expect(c.locator('a[href="02-signin.html"]')).toBeVisible()
    await expect(c.locator('a[href="05-password-reset.html"]')).toBeVisible()
    const u = card(page, 'signup-service-unavailable')
    await expect(u).toContainText("We couldn't create your account right now.")
    await expect(u.locator("[data-action='social-google']")).toBeVisible()
    await expect(u.locator("[data-action='retry']")).toBeVisible()
  })

  test('mfa-required (info handoff) and unverified-gate (resend)', async ({ page }) => {
    await expect(card(page, 'mfa-required').locator('.alert--info')).toContainText('One more step.')
    const g = card(page, 'unverified-gate')
    await expect(g).toContainText('Verify your email to continue')
    await expect(g.locator("[data-action='resend']")).toBeVisible()
  })
})
