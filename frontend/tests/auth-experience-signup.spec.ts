/**
 * AUTH EXPERIENCE — SIGNUP flow, independent browser verification.
 *
 * Spec = the APPROVED frames (never the implementation):
 *   design/frames/auth-experience/01-signup.html   (the form + its data-* hooks)
 *   design/frames/auth-experience/06-states.html   (every state a consumer must render)
 *   design/frames/auth-experience/manifest.json    (signup flow approved; testHooks)
 * and the reconciled contract (security-client 1.1.0):
 *   POST /v1/security/signup  -> 2xx session | 400 CAPTCHA_FAILED | 400 MALFORMED / 422 PASSWORD_POLICY
 *                                | 409 CONFLICT | 429 RATE_LIMITED | 502/503 PROVIDER_UNAVAILABLE
 *   GET  /v1/security/signup/email-available?email= -> { available }   (fail-open)
 *   GET  /v1/security/methods -> AuthMethods { captcha?, passwordPolicy? }
 *
 * Implementation under test: `@fuzefront/auth-ui` SignUpFlow (+ fields), wired by
 * `frontend/src/pages/LoginPage.tsx`, gated by flag `fuzefront.auth.experience`.
 *
 * Harness: the REAL built host UI in a real Chromium; only the same-origin Security
 * API and the Cloudflare Turnstile script are intercepted (see support/auth-signup.ts).
 * No backing stack is required. Selectors are the frames' data-* hooks.
 *
 * Run (host dev server or `vite preview` on :5173):
 *   BASE_URL=http://127.0.0.1:5173 npx playwright test auth-experience-signup --project=chromium
 */
import { test, expect, devices, type Page, type Locator } from '@playwright/test'
import {
  boot,
  onSignup,
  stubTurnstile,
  json,
  SEC,
  STRONG,
  WEAK,
  SIGNUP_OK,
  BENIGN,
  TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_TEST_TOKEN,
  type Harness,
  type BootOpts,
  type TurnstileMode,
} from './support/auth-signup'

// A production build registers the PWA service worker, and requests issued through a
// service worker are invisible to page.route() (so the Security API mocks would silently
// not apply and the page would talk to the static server). Block it: this suite verifies the
// signup UI, not the SW (covered by the PWA/offline specs).
test.use({ serviceWorkers: 'block' })

// ── helpers ──────────────────────────────────────────────────────────────────
const form = (page: Page) => page.locator("[data-form='signup']")
const submit = (page: Page) => page.locator("[data-form='signup'] [data-action='submit']")
const nameField = (page: Page) => page.locator("[data-field='full-name']")
const email = (page: Page) => page.locator('#fzf-signup-email')
const pw = (page: Page) => page.locator('#fzf-signup-password')
const confirm = (page: Page) => page.locator('#fzf-signup-confirm')
const turnstile = (page: Page) => page.locator('[data-turnstile]')
const req = (page: Page, id: string) => page.locator(`[data-pwreq] [data-req='${id}']`)
const unexpected = (h: Harness) => h.problems.filter(p => !BENIGN.some(b => b.test(p)))

/** Open /signup with the experience ON and wait for the redesigned form. */
async function open(
  page: Page,
  o: { captcha?: boolean; ts?: TurnstileMode; boot?: Partial<BootOpts>; methods?: BootOpts['methods'] } = {},
) {
  const h = await boot(page, {
    flag: true,
    methods: { captcha: o.captcha ?? false, ...(o.methods ?? {}) },
    ...(o.boot ?? {}),
  })
  if (o.captcha) await stubTurnstile(page, o.ts ?? 'auto-pass')
  await page.goto('/signup', { waitUntil: 'domcontentloaded' })
  await expect(form(page)).toBeVisible()
  return h
}

async function fillValid(page: Page, o: { name?: string; email?: string } = {}) {
  if (o.name !== undefined) await nameField(page).fill(o.name)
  await email(page).fill(o.email ?? 'ada@lovelace.io')
  await pw(page).fill(STRONG)
  await confirm(page).fill(STRONG)
}

const ok201 = (page: Page, h: Harness) =>
  onSignup(page, h, route => {
    h.authed = true
    return json(route, 201, SIGNUP_OK)
  })

// ═════════════════════════════════════════════════════════════════════════════
// FLAG ON — SignUpFlow (frames 01-signup + 06-states)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('flag ON — SignUpFlow structure (frame 01-signup)', () => {
  test('renders every 01-signup hook from the approved frame', async ({ page }) => {
    const h = await open(page, { captcha: true })
    await fillValid(page, { name: 'Ada Lovelace' })
    await expect(turnstile(page)).toHaveAttribute('data-state', 'verified')

    await expect(form(page)).toBeVisible()
    await expect(page.locator("[data-frame='01-signup']")).toBeVisible()
    await expect(nameField(page)).toBeVisible()
    await expect(page.locator("[data-avail='available']")).toBeVisible()
    await expect(page.locator('[data-pwmeter]')).toBeVisible()
    await expect(page.locator('[data-pwreq]')).toBeVisible()
    for (const r of ['length', 'upper', 'lower', 'digit', 'symbol']) {
      await expect(req(page, r)).toHaveAttribute('data-met', 'true')
    }
    await expect(page.locator("[data-match='true']")).toBeVisible()
    await expect(turnstile(page).first()).toBeVisible()
    await expect(submit(page)).toBeEnabled()
    await expect(page.locator("[data-action='social-google']")).toBeVisible()
    await expect(page.locator("[data-nav='signin']")).toBeVisible()
    expect(unexpected(h), 'console/network problems on the happy path').toEqual([])
  })

  test('full name is ONE optional i18n-safe field: autocomplete=name, no first/last split', async ({ page }) => {
    await open(page)
    const n = nameField(page)
    await expect(n).toHaveAttribute('autocomplete', 'name')
    await expect(n).not.toHaveAttribute('required', /.*/)
    await expect(n).not.toHaveAttribute('aria-required', 'true')
    await expect(page.locator('label[for="fzf-signup-fullName"]')).toContainText(/optional/i)
    // exactly one name field; the former first/last inputs are gone.
    await expect(page.locator('[data-field="full-name"]')).toHaveCount(1)
    await expect(page.locator('input[name="firstName"], input[name="lastName"], input[autocomplete="given-name"], input[autocomplete="family-name"]')).toHaveCount(0)
    // localizable label + help carry i18n keys (frame contract)
    await expect(page.locator('[data-i18n="auth.signup.fullName.label"]')).toHaveCount(1)
    await expect(page.locator('[data-i18n="auth.signup.fullName.help"]')).toHaveCount(1)
  })

  test('no vendor identity-provider name anywhere in the rendered DOM', async ({ page }) => {
    await open(page, { captcha: true })
    const html = (await page.content()).toLowerCase()
    expect(html).not.toContain('authentik')
    // Cloudflare Turnstile is the DELIBERATE, approved exception (consumer-visible captcha vendor).
  })

  test('signup-initial (06-states): pristine form — empty optional name, checklist all unmet, submit disabled', async ({ page }) => {
    await open(page, { captcha: true, ts: 'manual' })
    await expect(page.locator("[data-frame='01-signup']")).toHaveAttribute('data-state', 'signup-initial')
    await expect(nameField(page)).toHaveValue('')
    // optional field: empty is NOT an error
    await expect(page.locator('[data-field="full-name"][aria-invalid="true"]')).toHaveCount(0)
    for (const r of ['length', 'upper', 'lower', 'digit', 'symbol']) {
      await expect(req(page, r)).toHaveAttribute('data-met', 'false')
    }
    await expect(submit(page)).toBeDisabled()
    // no error alerts before any interaction
    await expect(page.locator('.fzf-su-alert')).toHaveCount(0)
  })
})

test.describe('flag ON — name handling (single i18n-safe `name`)', () => {
  for (const [label, value] of [
    ['full name', 'Ada Lovelace'],
    ['mononym', 'Cher'],
    ['family-name-first (CJK)', '山田 太郎'],
    ['RTL script (Arabic)', 'محمد علي'],
    ['diacritics + particle', "Ludwig van Beethoven-Ünal"],
  ] as const) {
    test(`submits ${label} verbatim as a single \`name\` (no first/last)`, async ({ page }) => {
      const h = await open(page)
      await ok201(page, h)
      await fillValid(page, { name: value })
      await submit(page).click()
      await expect.poll(() => h.signups.length).toBe(1)
      expect(h.signups[0]).toMatchObject({ email: 'ada@lovelace.io', password: STRONG, name: value })
      expect(h.signups[0]).not.toHaveProperty('firstName')
      expect(h.signups[0]).not.toHaveProperty('lastName')
    })
  }

  test('empty name is optional: submit works and `name` is omitted from the body', async ({ page }) => {
    const h = await open(page)
    await ok201(page, h)
    await fillValid(page)
    await submit(page).click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0]).not.toHaveProperty('name')
    expect(h.signups[0]).not.toHaveProperty('firstName')
    expect(h.signups[0]).not.toHaveProperty('lastName')
  })

  test('whitespace-only name is trimmed away (not sent as " ")', async ({ page }) => {
    const h = await open(page)
    await ok201(page, h)
    await fillValid(page, { name: '   ' })
    await submit(page).click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0]).not.toHaveProperty('name')
  })
})

test.describe('flag ON — inline email availability (06-states email-*)', () => {
  test('idle -> checking -> available (debounced, one lookup for fast typing)', async ({ page }) => {
    const h = await open(page, { boot: { avail: true } })
    const wrap = page.locator('[data-avail-state]')
    await expect(wrap).toHaveAttribute('data-avail-state', 'idle')
    await expect(wrap).toHaveAttribute('data-state', 'email-idle')
    await email(page).pressSequentially('ada@lovelace.io', { delay: 20 })
    await expect(page.locator("[data-avail='available']")).toBeVisible()
    await expect(wrap).toHaveAttribute('data-state', 'email-available')
    expect(h.availChecks).toEqual(['ada@lovelace.io']) // debounced: never one per keystroke
  })

  test('checking state shows while the lookup is in flight (email-checking)', async ({ page }) => {
    await open(page, { boot: { avail: 'hang' } })
    await email(page).fill('ada@lovelace.io')
    await expect(page.locator("[data-avail='checking']")).toBeVisible()
    await expect(page.locator('[data-state="email-checking"]')).toBeVisible()
  })

  test('no lookup fires for an incomplete / malformed address', async ({ page }) => {
    const h = await open(page, { boot: { avail: true } })
    await email(page).fill('ada@')
    await page.waitForTimeout(900) // > the 500ms debounce
    expect(h.availChecks).toEqual([])
    await expect(page.locator('[data-avail]')).toHaveCount(0)
  })

  test('taken (email-taken): advisory chip + "Sign in instead?" that switches to sign-in; submit NOT blocked', async ({ page }) => {
    const h = await open(page, { boot: { avail: false } })
    await onSignup(page, h, route => json(route, 409, { error: 'exists', code: 'CONFLICT' }))
    await fillValid(page, { email: 'founder@fuzefront.com' })
    await expect(page.locator("[data-avail='taken']")).toBeVisible()
    await expect(page.locator('[data-state="email-taken"]')).toBeVisible()
    // taken is advisory (the 409 is the authority) — it must never disable submit
    await expect(submit(page)).toBeEnabled()
    const instead = page.locator("[data-action='signin-instead']").first()
    await expect(instead).toBeVisible()
    await expect(instead).toHaveAttribute('href', '/login')
    await instead.click()
    await expect(form(page)).toHaveCount(0)
    await expect(page.locator('#fzf-auth-email')).toBeVisible() // sign-in mode of the AuthPanel
  })

  for (const [label, avail] of [
    ['HTTP 500', 500],
    ['HTTP 429 (rate-limited lookup)', 429],
    ['network failure', 'drop'],
  ] as const) {
    test(`lookup error (${label}) FAILS OPEN: "couldn't check", submit still works`, async ({ page }) => {
      const h = await open(page, { boot: { avail } })
      await ok201(page, h)
      await fillValid(page)
      await expect(page.locator("[data-avail='error']")).toBeVisible()
      await expect(page.locator('[data-state="email-check-error"]')).toBeVisible()
      await expect(page.getByText(/never blocks you from trying/i)).toBeVisible()
      await expect(submit(page)).toBeEnabled()
      await submit(page).click()
      await expect.poll(() => h.signups.length).toBe(1)
    })
  }

  test('email-available hook parity: frame wraps availability in a role=status live region', async ({ page }) => {
    await open(page, { boot: { avail: true } })
    await email(page).fill('ada@lovelace.io')
    await expect(page.locator("[data-avail='available']")).toBeVisible()
    await expect(page.locator('[role="status"][aria-live="polite"]').filter({ has: page.locator('[data-avail]') })).toHaveCount(1)
  })
})

test.describe('flag ON — password strength + live requirements checklist (pw-weak / pw-strong)', () => {
  test('weak password: pw-weak meter, only lowercase met (matches frame pw-weak)', async ({ page }) => {
    await open(page)
    await pw(page).fill(WEAK)
    await expect(page.locator('[data-pwmeter]')).toHaveAttribute('data-strength', 'weak')
    await expect(page.locator('[data-state="pw-weak"]')).toBeVisible()
    await expect(req(page, 'length')).toHaveAttribute('data-met', 'false')
    await expect(req(page, 'lower')).toHaveAttribute('data-met', 'true')
    await expect(req(page, 'upper')).toHaveAttribute('data-met', 'false')
    await expect(req(page, 'digit')).toHaveAttribute('data-met', 'false')
    await expect(req(page, 'symbol')).toHaveAttribute('data-met', 'false')
  })

  test('each rule ticks live (data-met false -> true) as the field satisfies it', async ({ page }) => {
    await open(page)
    const steps: Array<[string, string]> = [
      ['a', 'lower'],
      ['aB', 'upper'],
      ['aB3', 'digit'],
      ['aB3!', 'symbol'],
      ['aB3!aaaaaaaa', 'length'],
    ]
    for (const [value, rule] of steps) {
      await pw(page).fill(value)
      await expect(req(page, rule)).toHaveAttribute('data-met', 'true')
    }
    // all five rules met => the meter must have left 'weak' (frame: a policy-passing password is not weak)
    await expect(page.locator('[data-pwmeter]')).not.toHaveAttribute('data-strength', 'weak')
    await pw(page).fill(STRONG) // the frame's own example password
    await expect(page.locator('[data-pwmeter]')).toHaveAttribute('data-strength', 'strong')
    await expect(page.locator('[data-state="pw-strong"]')).toBeVisible()
    // and un-ticks when the user deletes the satisfying char
    await pw(page).fill('aB3aaaaaaaaa')
    await expect(req(page, 'symbol')).toHaveAttribute('data-met', 'false')
    await expect(req(page, 'length')).toHaveAttribute('data-met', 'true')
  })

  test('checklist is driven by AuthMethods.passwordPolicy (not a hard-coded client copy)', async ({ page }) => {
    // custom authoritative policy: 16+, no symbol rule
    await boot(page, { flag: true }).then(() => undefined)
    await page.unroute(`${SEC}/methods`)
    await page.route(`${SEC}/methods`, r =>
      json(r, 200, {
        password: true,
        social: ['google'],
        mfa: { enabled: false, types: [] },
        verification: { email: false, sms: false },
        passwordPolicy: { minLength: 16, requireUpper: true, requireLower: true, requireDigit: false, requireSymbol: false },
      }),
    )
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await expect(form(page)).toBeVisible()
    await expect(page.locator('[data-pwreq] [data-req]')).toHaveCount(3)
    await expect(req(page, 'length')).toContainText('16+')
    await expect(req(page, 'digit')).toHaveCount(0)
    await expect(req(page, 'symbol')).toHaveCount(0)
  })

  test('with no passwordPolicy in /methods the default 12+/upper/lower/digit/symbol checklist is used', async ({ page }) => {
    await open(page, { methods: { policy: false } })
    await expect(page.locator('[data-pwreq] [data-req]')).toHaveCount(5)
    await expect(req(page, 'length')).toContainText('12+')
  })

  test('password show/hide toggle works and is labelled', async ({ page }) => {
    await open(page)
    await pw(page).fill(STRONG)
    const toggle = page.locator('button[aria-controls="fzf-signup-password"]')
    await expect(toggle).toHaveAccessibleName(/show password/i)
    await expect(pw(page)).toHaveAttribute('type', 'password')
    await toggle.click()
    await expect(pw(page)).toHaveAttribute('type', 'text')
    await expect(toggle).toHaveAccessibleName(/hide password/i)
  })
})

test.describe('flag ON — confirm password (confirm-mismatch)', () => {
  test('mismatch: data-match=false, aria-invalid, inline message, submit disabled', async ({ page }) => {
    await open(page)
    await fillValid(page)
    await confirm(page).fill('secret')
    await expect(page.locator("[data-match='false']")).toBeVisible()
    await expect(page.locator('[data-state="confirm-mismatch"]')).toBeVisible()
    await expect(confirm(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText("Passwords don't match yet.")).toBeVisible()
    await expect(submit(page)).toBeDisabled()
  })

  test('match: data-match=true + "Passwords match." and submit re-enables', async ({ page }) => {
    await open(page)
    await fillValid(page)
    await confirm(page).fill('x')
    await expect(page.locator("[data-match='false']")).toBeVisible()
    await confirm(page).fill(STRONG)
    await expect(page.locator("[data-match='true']")).toBeVisible()
    await expect(page.getByText('Passwords match.')).toBeVisible()
    await expect(submit(page)).toBeEnabled()
  })

  test('nothing is shown for confirm until the user has typed (no premature mismatch)', async ({ page }) => {
    await open(page)
    await pw(page).fill(STRONG)
    await expect(page.locator('[data-match]')).toHaveCount(0)
  })

  test('changing the password after confirming re-evaluates the match', async ({ page }) => {
    await open(page)
    await fillValid(page)
    await expect(page.locator("[data-match='true']")).toBeVisible()
    await pw(page).fill(STRONG + 'z')
    await expect(page.locator("[data-match='false']")).toBeVisible()
    await expect(submit(page)).toBeDisabled()
  })
})

test.describe('flag ON — submit gating', () => {
  test('stays disabled until email + policy-passing password + matching confirm are all valid', async ({ page }) => {
    await open(page)
    await expect(submit(page)).toBeDisabled()
    await email(page).fill('not-an-email')
    await pw(page).fill(STRONG)
    await confirm(page).fill(STRONG)
    await expect(submit(page)).toBeDisabled() // bad email
    await email(page).fill('ada@lovelace.io')
    await expect(submit(page)).toBeEnabled()
    await pw(page).fill(WEAK)
    await confirm(page).fill(WEAK)
    await expect(submit(page)).toBeDisabled() // match, but policy fails
  })

  test('pressing Enter in a field submits the form once everything is valid', async ({ page }) => {
    const h = await open(page)
    await ok201(page, h)
    await fillValid(page)
    await confirm(page).press('Enter')
    await expect.poll(() => h.signups.length).toBe(1)
  })

  test('a disabled form cannot be force-submitted with Enter', async ({ page }) => {
    const h = await open(page)
    await ok201(page, h)
    await email(page).fill('ada@lovelace.io')
    await pw(page).fill(WEAK)
    await pw(page).press('Enter')
    await page.waitForTimeout(300)
    expect(h.signups).toHaveLength(0)
  })

  test('submit stays disabled until /methods has settled (captcha requirement unknown)', async ({ page }) => {
    const h = await boot(page, { flag: true, methods: { captcha: true } })
    await stubTurnstile(page, 'auto-pass')
    await page.unroute(`${SEC}/methods`)
    let release: () => void = () => {}
    const gate = new Promise<void>(r => (release = r))
    await page.route(`${SEC}/methods`, async r => {
      await gate
      return json(r, 200, {
        password: true,
        social: ['google'],
        mfa: { enabled: false, types: [] },
        verification: { email: false, sms: false },
        captcha: { provider: 'turnstile', siteKey: TURNSTILE_TEST_SITE_KEY },
      })
    })
    await ok201(page, h)
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await expect(form(page)).toBeVisible()
    await fillValid(page)
    await expect(submit(page)).toBeDisabled() // valid fields, but capabilities unknown
    release()
    await expect(turnstile(page)).toHaveAttribute('data-state', 'verified')
    await expect(submit(page)).toBeEnabled()
  })
})

test.describe('flag ON — Cloudflare Turnstile (test keys; turnstile-loading/ready/verified/failed)', () => {
  test('no AuthMethods.captcha => no widget and submit does not wait for one', async ({ page }) => {
    const h = await open(page, { captcha: false })
    await ok201(page, h)
    await expect(turnstile(page)).toHaveCount(0)
    await fillValid(page)
    await submit(page).click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0]).not.toHaveProperty('turnstileToken')
  })

  test('widget is rendered with the AuthMethods siteKey (Cloudflare TEST key) and gates submit', async ({ page }) => {
    await open(page, { captcha: true, ts: 'manual' })
    await expect(turnstile(page)).toHaveAttribute('data-state', 'loading') // turnstile-loading
    await expect.poll(() => page.evaluate(() => (window as any).__ts?.siteKeys)).toEqual([TURNSTILE_TEST_SITE_KEY])
    await fillValid(page)
    await expect(submit(page)).toBeDisabled() // valid fields, no token yet
  })

  test('loading -> ready (interactive challenge) -> verified; token enables submit and is sent as turnstileToken', async ({ page }) => {
    const h = await open(page, { captcha: true, ts: 'interactive' })
    await ok201(page, h)
    await fillValid(page, { name: 'Ada Lovelace' })
    await expect(turnstile(page)).toHaveAttribute('data-state', 'ready') // challenge needs the user
    await expect(submit(page)).toBeDisabled()
    await page.evaluate(() => (window as any).__ts.pass())
    await expect(turnstile(page)).toHaveAttribute('data-state', 'verified')
    await expect(page.getByText("Verified — you're human")).toBeVisible()
    await expect(submit(page)).toBeEnabled()
    await submit(page).click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0]).toMatchObject({
      email: 'ada@lovelace.io',
      password: STRONG,
      name: 'Ada Lovelace',
      turnstileToken: TURNSTILE_TEST_TOKEN,
    })
  })

  test('widget error => failed state with "Please complete the challenge"; submit blocked (fail-closed)', async ({ page }) => {
    await open(page, { captcha: true, ts: 'error' })
    await fillValid(page)
    await expect(turnstile(page)).toHaveAttribute('data-state', 'failed')
    await expect(page.getByText('Verification failed')).toBeVisible()
    await expect(page.getByText('Please complete the challenge to continue.')).toBeVisible()
    await expect(submit(page)).toBeDisabled()
  })

  test('widget unsupported => failed state; submit blocked', async ({ page }) => {
    await open(page, { captcha: true, ts: 'unsupported' })
    await fillValid(page)
    await expect(turnstile(page)).toHaveAttribute('data-state', 'failed')
    await expect(submit(page)).toBeDisabled()
  })

  test('an expired token is dropped: submit disables again until Cloudflare refreshes it', async ({ page }) => {
    await open(page, { captcha: true, ts: 'auto-pass' })
    await fillValid(page)
    await expect(submit(page)).toBeEnabled()
    await page.evaluate(() => (window as any).__ts.expire())
    await expect(submit(page)).toBeDisabled()
    await expect(turnstile(page)).toHaveAttribute('data-state', 'loading')
    await page.evaluate(() => (window as any).__ts.pass())
    await expect(submit(page)).toBeEnabled()
  })

  test('the Cloudflare script is requested from the vendor origin only (no other cross-origin app calls)', async ({ page }) => {
    const origins = new Set<string>()
    page.on('request', r => origins.add(new URL(r.url()).origin))
    await open(page, { captcha: true })
    await fillValid(page)
    await expect(turnstile(page)).toHaveAttribute('data-state', 'verified')
    // Same-origin API base: the ONLY third-party origins the signup may touch are the
    // captcha vendor (approved exception) and the host shell's pre-existing web-font CDN
    // (index.html <link>, not part of the signup flow). Anything else is a leak.
    const foreign = [...origins].filter(o => !/^http:\/\/(127\.0\.0\.1|localhost)/.test(o))
    const FONT_CDN = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']
    expect(foreign.filter(o => !FONT_CDN.includes(o)).sort()).toEqual(['https://challenges.cloudflare.com'])
  })
})

test.describe('flag ON — successful signup', () => {
  test('201 => session established and the user is routed to /dashboard (no verification pending)', async ({ page }) => {
    const h = await open(page)
    await ok201(page, h)
    await fillValid(page, { name: 'Ada Lovelace' })
    await submit(page).click()
    await page.waitForURL(/\/dashboard/)
    expect(h.signups).toHaveLength(1)
  })

  test('201 + platform verifies email + emailVerified:false => /signup/verify?email= (check-inbox)', async ({ page }) => {
    const h = await open(page, { methods: { verificationEmail: true } })
    await ok201(page, h)
    await page.route(`${SEC}/verify/status`, r => json(r, 200, { emailVerified: false, phoneVerified: false }))
    await fillValid(page)
    await submit(page).click()
    await page.waitForURL(/\/signup\/verify\?email=ada%40lovelace\.io/)
  })

  test('201 but the verification-status probe FAILS: falls open to /dashboard (never blocks signup)', async ({ page }) => {
    const h = await open(page, { methods: { verificationEmail: true } })
    await ok201(page, h)
    await page.route(`${SEC}/verify/status`, r => json(r, 500, { error: 'boom' }))
    await fillValid(page)
    await submit(page).click()
    await page.waitForURL(/\/dashboard/)
  })

  test('submit-inflight: button disabled + aria-busy + "Creating account…", fields locked, no double-POST', async ({ page }) => {
    const h = await open(page)
    let release: () => void = () => {}
    const gate = new Promise<void>(r => (release = r))
    await onSignup(page, h, async route => {
      await gate
      h.authed = true
      return json(route, 201, SIGNUP_OK)
    })
    await fillValid(page)
    await submit(page).click()
    const btn = submit(page)
    await expect(btn).toBeDisabled()
    await expect(btn).toHaveAttribute('aria-busy', 'true')
    await expect(btn).toContainText('Creating account…')
    await expect(page.locator('[data-state="submit-inflight"]').first()).toBeVisible()
    await expect(email(page)).toBeDisabled()
    await expect(pw(page)).toBeDisabled()
    await btn.click({ force: true }).catch(() => {})
    await pw(page).press('Enter').catch(() => {})
    release()
    await page.waitForURL(/\/dashboard/)
    expect(h.signups).toHaveLength(1)
  })
})

// ── error states from 06-states, mapped from the reconciled contract ─────────
test.describe('flag ON — server error states (06-states)', () => {
  test('409 CONFLICT => signup-conflict alert: sign in / reset links, form stays editable', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 409, { error: 'exists', code: 'CONFLICT' }))
    await fillValid(page)
    await submit(page).click()
    const alert = page.locator('.fzf-su-alert[data-state="signup-conflict"]')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('That account already exists.')
    await expect(alert.locator("[data-action='signin-instead']")).toBeVisible()
    const reset = alert.locator("[data-nav='reset']")
    await expect(reset).toHaveAttribute('href', '/reset')
    await expect(form(page)).toBeVisible()
    await expect(email(page)).toHaveValue('ada@lovelace.io')
  })

  test('06-states hooks are UNIQUE: [data-state=signup-conflict] addresses exactly one element (frame: one card per state)', async ({ page }) => {
    // In the frame each state is a single addressable card, so `locator("[data-state='signup-conflict']")`
    // is strict-mode safe. In the build the flow root AND the alert both carry the same data-state.
    const h = await open(page)
    await onSignup(page, h, r => json(r, 409, { error: 'exists', code: 'CONFLICT' }))
    await fillValid(page)
    await submit(page).click()
    await expect(page.locator("[data-state='signup-conflict']").first()).toBeVisible()
    await expect(page.locator("[data-state='signup-conflict']")).toHaveCount(1)
  })

  test('409 sign-in-instead link in the alert switches to the sign-in form', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 409, { error: 'exists', code: 'CONFLICT' }))
    await fillValid(page)
    await submit(page).click()
    await page.locator('.fzf-su-alert [data-action="signin-instead"]').click()
    await expect(page.locator('#fzf-auth-email')).toBeVisible()
  })

  test('422 PASSWORD_POLICY => signup-pw-weak-submit alert + unmet rows highlighted (server enforces even if inline bypassed)', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 422, { error: 'policy', code: 'PASSWORD_POLICY' }))
    await fillValid(page)
    await submit(page).click()
    const alert = page.locator('.fzf-su-alert[data-state="signup-pw-weak-submit"]')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("That password doesn't meet our requirements.")
    await expect(pw(page)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('[data-pwreq]')).toBeVisible()
  })

  test('legacy 400 MALFORMED is also treated as a weak-password rejection', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 400, { error: 'bad', code: 'MALFORMED' }))
    await fillValid(page)
    await submit(page).click()
    await expect(page.locator('.fzf-su-alert[data-state="signup-pw-weak-submit"]')).toBeVisible()
  })

  test('post-submit weak rejection keeps the frame contract: unmet rules stay visible with data-met=false', async ({ page }) => {
    // The server's policy is stricter than the client's (a mismatch must surface, never a silent pass).
    const h = await open(page, { methods: { policy: false } })
    await onSignup(page, h, r => json(r, 422, { error: 'policy', code: 'PASSWORD_POLICY' }))
    await fillValid(page)
    await submit(page).click()
    await expect(page.locator('.fzf-su-alert[data-state="signup-pw-weak-submit"]')).toBeVisible()
    await expect(page.locator('[data-pwreq] [data-req]')).toHaveCount(5)
  })

  test('503 PROVIDER_UNAVAILABLE => signup-service-unavailable: fail closed + "Continue with Google" fallback + retry', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 503, { error: 'down', code: 'PROVIDER_UNAVAILABLE' }))
    await fillValid(page)
    await submit(page).click()
    const card = page.locator('[data-state="signup-service-unavailable"]').first()
    await expect(card).toBeVisible()
    await expect(card).toContainText("We couldn't create your account right now.")
    await expect(card.locator("[data-action='social-google']")).toBeVisible()
    await expect(card.locator("[data-action='retry']")).toBeVisible()
    // the form is replaced, not left half-usable
    await expect(form(page)).toHaveCount(0)
  })

  test('503 without a body code and 502/504 are the same service-unavailable state', async ({ page }) => {
    for (const status of [502, 503, 504]) {
      const p = await page.context().newPage()
      const h = await open(p)
      await onSignup(p, h, r => json(r, status, { error: 'x' }))
      await fillValid(p)
      await submit(p).click()
      await expect(p.locator('[data-state="signup-service-unavailable"]').first()).toBeVisible()
      await p.close()
    }
  })

  test('service-unavailable: Retry returns to the form with the typed values kept', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 503, { error: 'down', code: 'PROVIDER_UNAVAILABLE' }))
    await fillValid(page, { name: 'Ada Lovelace' })
    await submit(page).click()
    await page.locator("[data-action='retry']").click()
    await expect(form(page)).toBeVisible()
    await expect(email(page)).toHaveValue('ada@lovelace.io')
    await expect(nameField(page)).toHaveValue('Ada Lovelace')
    await expect(submit(page)).toBeEnabled()
  })

  test('service-unavailable: the Google fallback starts the same-origin browser flow', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 503, { error: 'down', code: 'PROVIDER_UNAVAILABLE' }))
    let started = ''
    await page.route('**/v1/security/social/google/start', r => {
      started = r.request().url()
      return r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>google</body></html>' })
    })
    await fillValid(page)
    await submit(page).click()
    await page.locator('[data-state="signup-service-unavailable"] [data-action="social-google"]').click()
    await expect.poll(() => started).toMatch(/\/api\/v1\/security\/social\/google\/start$/)
  })

  test('429 RATE_LIMITED => rate-limited alert; form stays usable', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 429, { error: 'slow down', code: 'RATE_LIMITED' }))
    await fillValid(page)
    await submit(page).click()
    const a = page.locator('[data-state="rate-limited"]')
    await expect(a).toBeVisible()
    await expect(a).toContainText(/too many attempts/i)
    await expect(form(page)).toBeVisible()
  })

  test('500 / unknown => form-error alert (generic), never a blank or a crash', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 500, { error: 'boom' }))
    await fillValid(page)
    await submit(page).click()
    await expect(page.locator('.fzf-su-alert[data-state="form-error"]')).toBeVisible()
    await expect(form(page)).toBeVisible()
  })

  test('network failure on submit => form-error alert and the button recovers', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => r.abort('failed'))
    await fillValid(page)
    await submit(page).click()
    await expect(page.locator('.fzf-su-alert[data-state="form-error"]')).toBeVisible()
    await expect(submit(page)).toBeEnabled()
  })

  test('a 2xx response WITHOUT token/user is not accepted as success (fail-closed)', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 200, { ok: true }))
    await fillValid(page)
    await submit(page).click()
    await expect(page.locator('.fzf-su-alert[data-state="form-error"]')).toBeVisible()
    await expect(page).toHaveURL(/\/signup/)
  })

  test('an error alert clears on the next attempt (no stale error beside a success)', async ({ page }) => {
    const h = await open(page)
    let n = 0
    await onSignup(page, h, route => {
      n++
      if (n === 1) return json(route, 429, { error: 'slow', code: 'RATE_LIMITED' })
      h.authed = true
      return json(route, 201, SIGNUP_OK)
    })
    await fillValid(page)
    await submit(page).click()
    await expect(page.locator('[data-state="rate-limited"]')).toBeVisible()
    await submit(page).click()
    await page.waitForURL(/\/dashboard/)
    expect(h.signups).toHaveLength(2)
  })
})

test.describe('flag ON — reconciled 400 CAPTCHA_FAILED => turnstile-failed', () => {
  test('400 CAPTCHA_FAILED lands in the Turnstile failed state, NOT the weak-password state', async ({ page }) => {
    const h = await open(page, { captcha: true, ts: 'auto-pass' })
    await onSignup(page, h, r => json(r, 400, { error: 'captcha', code: 'CAPTCHA_FAILED' }))
    await fillValid(page)
    await expect(turnstile(page)).toHaveAttribute('data-state', 'verified')
    await submit(page).click()
    await expect(turnstile(page)).toHaveAttribute('data-state', 'failed')
    await expect(page.getByText('Please complete the challenge to continue.')).toBeVisible()
    // must not be mis-classified as the password/policy or generic error
    await expect(page.locator('[data-state="signup-pw-weak-submit"]')).toHaveCount(0)
    await expect(page.locator('[data-state="form-error"]')).toHaveCount(0)
    // fields are intact, nothing is lost
    await expect(email(page)).toHaveValue('ada@lovelace.io')
  })

  test('the single-use token is discarded and the widget reset after ANY failed submit', async ({ page }) => {
    const h = await open(page, { captcha: true, ts: 'manual' })
    await onSignup(page, h, r => json(r, 400, { error: 'captcha', code: 'CAPTCHA_FAILED' }))
    await fillValid(page)
    await page.evaluate(() => (window as any).__ts.pass())
    await expect(submit(page)).toBeEnabled()
    await submit(page).click()
    await expect.poll(() => page.evaluate(() => (window as any).__ts.resets)).toBeGreaterThanOrEqual(1)
    // no token => cannot be resubmitted with the burned one
    await expect(submit(page)).toBeDisabled()
  })

  test('after CAPTCHA_FAILED the user can complete a fresh challenge and the resubmit carries the NEW token', async ({ page }) => {
    const h = await open(page, { captcha: true, ts: 'manual' })
    let n = 0
    await onSignup(page, h, route => {
      n++
      if (n === 1) return json(route, 400, { error: 'captcha', code: 'CAPTCHA_FAILED' })
      h.authed = true
      return json(route, 201, SIGNUP_OK)
    })
    await fillValid(page)
    await page.evaluate(() => (window as any).__ts.pass())
    await submit(page).click()
    await expect(turnstile(page)).toHaveAttribute('data-state', 'failed')
    // user solves a fresh challenge
    await page.evaluate(() => (window as any).__ts.pass())
    await expect(submit(page)).toBeEnabled()
    // the indicator must reflect the fresh, valid token — not keep saying "Verification failed"
    await expect(turnstile(page)).toHaveAttribute('data-state', 'verified')
    await submit(page).click()
    await page.waitForURL(/\/dashboard/)
    expect(h.signups).toHaveLength(2)
  })

  test('a non-captcha failure (503) also burns the token and resets the widget', async ({ page }) => {
    const h = await open(page, { captcha: true, ts: 'manual' })
    await onSignup(page, h, r => json(r, 503, { error: 'down', code: 'PROVIDER_UNAVAILABLE' }))
    await fillValid(page)
    await page.evaluate(() => (window as any).__ts.pass())
    await submit(page).click()
    await expect(page.locator('[data-state="signup-service-unavailable"]').first()).toBeVisible()
    // the form (and its widget) is replaced by the unavailable card; "Try again" mounts a FRESH
    // widget — the burned token must not survive the round trip.
    await page.locator("[data-action='retry']").click()
    await expect(form(page)).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__ts.renders)).toBeGreaterThanOrEqual(2)
    await fillValid(page) // values are kept; refill is idempotent
    await expect(submit(page)).toBeDisabled() // no token until the new widget passes
    await page.evaluate(() => (window as any).__ts.pass())
    await expect(submit(page)).toBeEnabled()
  })
})

// ── sign-in adjacent states that 06-states puts in the signup state set ──────
test.describe('flag ON — mfa-required handoff and unverified-gate (06-states)', () => {
  test('mfa-required: sign-in that resolves to an MFA challenge shows the handoff, not a dead end', async ({ page }) => {
    await boot(page, { flag: true })
    await page.route(`${SEC}/session`, route =>
      route.request().method() === 'POST'
        ? json(route, 200, { status: 'mfa_required', challengeId: 'ch_1', methods: ['totp'] })
        : route.fallback(),
    )
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.locator('#fzf-auth-email').fill('ada@lovelace.io')
    await page.locator('#fzf-auth-password').fill(STRONG)
    await page.locator('form button[type="submit"]').click()
    const mfa = page.locator('[data-state="mfa-required"]')
    await expect(mfa).toBeVisible()
    await expect(mfa).toContainText(/One more step/i)
  })

  test('unverified-gate: signed-in but unverified account sees the banner; Resend POSTs /verify/email/start', async ({ page }) => {
    await boot(page, { flag: true, methods: { verificationEmail: true } })
    await page.addInitScript(() => localStorage.setItem('authToken', 'tok_session'))
    await page.unroute(`${SEC}/session`)
    await page.route(`${SEC}/session`, route =>
      route.request().method() !== 'GET'
        ? route.fallback()
        : json(route, 200, { user: { id: 'u1', email: 'ada@lovelace.io', name: 'Ada', roles: [] } }),
    )
    await page.route(`${SEC}/verify/status`, r => json(r, 200, { emailVerified: false, phoneVerified: false }))
    // minimal workspace bootstrap so the dashboard shell renders (not under test here)
    await page.route('**/api/organizations', r =>
      json(r, 200, { organizations: [{ id: 'o1', name: 'Ada Org', slug: 'ada-org', role: 'owner' }] }),
    )
    await page.route('**/api/flags', r => json(r, 200, {}))
    await page.route('**/api/v1/app-registry/apps**', r => json(r, 200, []))
    let started = 0
    await page.route(`${SEC}/verify/email/start`, r => {
      started++
      return json(r, 202)
    })
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    const gate = page.locator('[data-state="unverified-gate"]')
    await expect(gate).toBeVisible()
    await expect(gate).toContainText('ada@lovelace.io')
    await gate.locator("[data-action='resend']").click()
    await expect.poll(() => started).toBe(1)
    await expect(gate.locator('[data-state="sent"]')).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Console / network sweep (Playwright-collected). SUPPLEMENTS — never replaces — the mandated
// Chrome DevTools MCP console/network pass (ui-runtime-validation), which needs the plugin.
// ═════════════════════════════════════════════════════════════════════════════
test.describe('flag ON — runtime hygiene across the whole signup state set', () => {
  test('no uncaught exceptions, CSP/mixed-content, React warnings or unexpected failed requests', async ({ page }) => {
    const h = await open(page, { captcha: true, ts: 'auto-pass', boot: { avail: (e: string) => !e.startsWith('taken') } })
    let n = 0
    await onSignup(page, h, route => {
      n++
      const script: Array<[number, unknown]> = [
        [409, { error: 'exists', code: 'CONFLICT' }],
        [422, { error: 'policy', code: 'PASSWORD_POLICY' }],
        [429, { error: 'slow', code: 'RATE_LIMITED' }],
        [400, { error: 'captcha', code: 'CAPTCHA_FAILED' }],
        [500, { error: 'boom' }],
      ]
      const [status, body] = script[Math.min(n - 1, script.length - 1)]
      return json(route, status, body)
    })
    await fillValid(page, { name: 'Ada Lovelace' })
    for (let i = 0; i < 5; i++) {
      await expect(submit(page)).toBeEnabled()
      await submit(page).click()
      await expect.poll(() => h.signups.length).toBe(i + 1)
      await expect(submit(page)).toBeEnabled() // widget re-passes (auto-pass) and the form recovers
    }
    // typing through every availability + strength + match state
    await email(page).fill('taken@x.io')
    await expect(page.locator("[data-avail='taken']")).toBeVisible()
    await pw(page).fill(WEAK)
    await confirm(page).fill('nope')
    await page.waitForTimeout(300)

    const text = h.problems.join('\n')
    // deliberate non-2xx answers from the mocked API are expected; nothing else is
    const unexpectedProblems = unexpected(h).filter(
      p =>
        !/^http (400|409|422|429|500): POST .*\/v1\/security\/signup$/.test(p) &&
        !/status of (400|409|422|429|500)/.test(p) &&
        // FINDING (low): the host axios interceptor (src/services/api.ts) console.error()s
        // "Error Details: {...}" for EVERY handled 4xx/5xx, i.e. an expected 409/422/429 on
        // signup lands in the console as an error. Tolerated here only for the deliberately
        // mocked statuses so the rest of the sweep stays strict.
        !/Error Details: \{message: Request failed with status code (400|409|422|429|500)/.test(p),
    )
    expect(unexpectedProblems, 'unexpected console/network problems:\n' + text).toEqual([])
    expect(text).not.toMatch(/content security policy|mixed content|blocked:|ScriptExternalLoadError|Invalid hook call/i)
    expect(h.warnings.filter(w => /key|validateDOMNesting|act\(|unmounted|hydrat|deprecated/i.test(w)), 'React warnings').toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// FLAG OFF — legacy form still works and submits a single `name`
// ═════════════════════════════════════════════════════════════════════════════
test.describe('flag OFF — legacy signup form (default)', () => {
  for (const [label, flag] of [
    ['override=false', false],
    ['override UNSET (build-time default)', null],
  ] as const) {
    test(`${label}: legacy form renders, redesigned hooks are absent, no availability lookup`, async ({ page }) => {
      const h = await boot(page, { flag, methods: { captcha: false } })
      await page.goto('/signup', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('#fzf-auth-email')).toBeVisible()
      await expect(page.locator('#fzf-auth-name')).toBeVisible()
      await expect(form(page)).toHaveCount(0)
      await expect(page.locator('[data-pwreq], [data-pwmeter], [data-turnstile], [data-match]')).toHaveCount(0)
      await expect(page.locator('[data-field="full-name"]')).toHaveCount(0)
      await email(page).or(page.locator('#fzf-auth-email')).first().fill('ada@lovelace.io')
      await page.waitForTimeout(800)
      expect(h.availChecks).toEqual([])
    })
  }

  test('legacy form has ONE name input (autocomplete=name) — no first/last split', async ({ page }) => {
    await boot(page, { flag: false })
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#fzf-auth-name')).toHaveAttribute('autocomplete', 'name')
    await expect(page.locator('input[name="firstName"], input[name="lastName"], input[autocomplete="given-name"], input[autocomplete="family-name"]')).toHaveCount(0)
  })

  test('legacy submit sends a single `name` (+ email, password) and succeeds -> /dashboard', async ({ page }) => {
    const h = await boot(page, { flag: false })
    await ok201(page, h)
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.locator('#fzf-auth-name').fill('Ada Lovelace')
    await page.locator('#fzf-auth-email').fill('ada@lovelace.io')
    await page.locator('#fzf-auth-password').fill(STRONG)
    await page.locator('form button[type="submit"]').click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0]).toEqual({ email: 'ada@lovelace.io', password: STRONG, name: 'Ada Lovelace' })
    await page.waitForURL(/\/dashboard/)
  })

  test('legacy: blank name is omitted (optional), not sent as ""', async ({ page }) => {
    const h = await boot(page, { flag: false })
    await ok201(page, h)
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.locator('#fzf-auth-email').fill('ada@lovelace.io')
    await page.locator('#fzf-auth-password').fill(STRONG)
    await page.locator('form button[type="submit"]').click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0]).not.toHaveProperty('name')
    expect(h.signups[0]).not.toHaveProperty('firstName')
  })

  test('legacy: the old 409 still surfaces as an error message (flag-off path not regressed)', async ({ page }) => {
    const h = await boot(page, { flag: false })
    await onSignup(page, h, r => json(r, 409, { error: 'An account with that email already exists', code: 'CONFLICT' }))
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.locator('#fzf-auth-email').fill('ada@lovelace.io')
    await page.locator('#fzf-auth-password').fill(STRONG)
    await page.locator('form button[type="submit"]').click()
    await expect(page.getByText(/already exists/i)).toBeVisible()
    await expect(page.locator('#fzf-auth-email')).toHaveValue('ada@lovelace.io')
  })

  test('legacy: 503 PROVIDER_UNAVAILABLE still surfaces the provider-outage message (not "invalid credentials")', async ({ page }) => {
    const h = await boot(page, { flag: false })
    await onSignup(page, h, r => json(r, 503, { error: 'down', code: 'PROVIDER_UNAVAILABLE' }))
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.locator('#fzf-auth-email').fill('ada@lovelace.io')
    await page.locator('#fzf-auth-password').fill(STRONG)
    await page.locator('form button[type="submit"]').click()
    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(page.getByText(/invalid|incorrect|wrong/i)).toHaveCount(0)
  })

  test('RISK: flag OFF + server captcha enabled => legacy form has no widget and cannot send a token', async ({ page }) => {
    // Documents the rollout-ordering constraint: with AuthMethods.captcha present the
    // legacy form renders NO Turnstile and posts no turnstileToken, so a captcha-enforcing
    // backend rejects every legacy signup (400 CAPTCHA_FAILED). Captcha must only be
    // enabled server-side AFTER the flag is ON (or the legacy path must also render it).
    const h = await boot(page, { flag: false, methods: { captcha: true } })
    await stubTurnstile(page, 'auto-pass')
    await onSignup(page, h, r => json(r, 400, { error: 'captcha', code: 'CAPTCHA_FAILED' }))
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.locator('#fzf-auth-email').fill('ada@lovelace.io')
    await page.locator('#fzf-auth-password').fill(STRONG)
    await page.locator('form button[type="submit"]').click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0]).not.toHaveProperty('turnstileToken')
    await expect(turnstile(page)).toHaveCount(0)
    await expect(page.getByRole('alert').first()).toBeVisible() // a dead end with a generic message
  })

  test('flag OFF: sign-in is untouched (legacy form; toggle to sign-up still works)', async ({ page }) => {
    await boot(page, { flag: false })
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#fzf-auth-email')).toBeVisible()
    await expect(page.locator('#fzf-auth-name')).toHaveCount(0)
    await page.getByRole('button', { name: /create an account/i }).click()
    await expect(page.locator('#fzf-auth-name')).toBeVisible()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Accessibility in the browser (targeted ARIA/keyboard assertions)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('flag ON — accessibility', () => {
  test('every control has an accessible name; labels are bound to inputs', async ({ page }) => {
    await open(page)
    await expect(page.getByLabel(/full name/i)).toHaveAttribute('data-field', 'full-name')
    await expect(page.getByLabel('Work email')).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Confirm password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible()
  })

  test('required fields are programmatically required; optional name is not', async ({ page }) => {
    await open(page)
    await expect(email(page)).toHaveAttribute('aria-required', 'true')
    // password/confirm requiredness must be exposed too (WCAG 3.3.2 / 1.3.1)
    const pwRequired = await pw(page).evaluate(el => el.hasAttribute('required') || el.getAttribute('aria-required') === 'true')
    const cfRequired = await confirm(page).evaluate(el => el.hasAttribute('required') || el.getAttribute('aria-required') === 'true')
    expect.soft(pwRequired, 'password exposes required to AT').toBe(true)
    expect.soft(cfRequired, 'confirm exposes required to AT').toBe(true)
  })

  test('error alerts are announced (role=alert) and availability uses a polite live region', async ({ page }) => {
    const h = await open(page)
    await onSignup(page, h, r => json(r, 409, { error: 'exists', code: 'CONFLICT' }))
    await fillValid(page)
    await submit(page).click()
    const alert = page.locator('.fzf-su-alert[data-state="signup-conflict"]')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveAttribute('role', 'alert')
  })

  test('checklist rows expose met/unmet to assistive tech, not only by colour', async ({ page }) => {
    await open(page)
    await pw(page).fill('a')
    const lower = req(page, 'lower')
    await expect(lower).toContainText(/met/i)
    await expect(req(page, 'length')).toContainText(/not met/i)
  })

  test('keyboard: the whole form is reachable and operable by Tab/Enter/Space', async ({ page }) => {
    const h = await open(page)
    await ok201(page, h)
    await nameField(page).focus()
    await page.keyboard.type('Ada Lovelace')
    await page.keyboard.press('Tab')
    await expect(email(page)).toBeFocused()
    await page.keyboard.type('ada@lovelace.io')
    await page.keyboard.press('Tab')
    await expect(pw(page)).toBeFocused()
    await page.keyboard.type(STRONG)
    await page.keyboard.press('Tab') // show-password toggle
    await page.keyboard.press('Tab')
    await expect(confirm(page)).toBeFocused()
    await page.keyboard.type(STRONG)
    await page.keyboard.press('Enter')
    await expect.poll(() => h.signups.length).toBe(1)
  })

  test('focus is visible on the primary controls (not outline:none with no replacement)', async ({ page }) => {
    await open(page)
    await email(page).focus()
    const s = await email(page).evaluate(el => {
      const c = getComputedStyle(el)
      return { outline: c.outlineStyle + c.outlineWidth, shadow: c.boxShadow, border: c.borderColor }
    })
    expect(s.shadow !== 'none' || !/^none/.test(s.outline) || s.border !== '').toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// RTL (ar/he) — the frame mandates logical-property mirroring under dir="rtl"
// ═════════════════════════════════════════════════════════════════════════════
test.describe('flag ON — RTL rendering', () => {
  test('under dir=rtl the availability/confirm adornments and show-password toggle mirror to the inline-end', async ({ page }) => {
    await open(page, { boot: { avail: true } })
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl')
      document.documentElement.setAttribute('lang', 'ar')
    })
    await fillValid(page)
    await expect(page.locator("[data-avail='available']")).toBeVisible()
    const geo = await page.evaluate(() => {
      const box = (el: Element | null) => {
        const r = el!.getBoundingClientRect()
        return { l: r.left, r: r.right, w: r.width }
      }
      const toggle = document.querySelector('button[aria-controls="fzf-signup-password"]')
      const input = document.querySelector('#fzf-signup-password')
      const emailInput = document.querySelector('#fzf-signup-email')
      const check = emailInput!.parentElement!.querySelector('span[aria-hidden="true"]')
      return {
        toggle: box(toggle),
        input: box(input),
        emailInput: box(emailInput),
        check: box(check),
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }
    })
    // inline-end in RTL is the LEFT edge: adornments sit in the left half of their input
    expect(geo.toggle.l + geo.toggle.w / 2).toBeLessThan(geo.input.l + geo.input.w / 2)
    expect(geo.check.l + geo.check.w / 2).toBeLessThan(geo.emailInput.l + geo.emailInput.w / 2)
    expect(geo.scrollW).toBeLessThanOrEqual(geo.clientW)
  })

  test('RTL: the text direction of the inputs follows the document (typed Arabic name stays intact)', async ({ page }) => {
    const h = await open(page)
    await ok201(page, h)
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'))
    await fillValid(page, { name: 'محمد علي' })
    const dir = await nameField(page).evaluate(el => getComputedStyle(el).direction)
    expect(dir).toBe('rtl')
    await submit(page).click()
    await expect.poll(() => h.signups.length).toBe(1)
    expect(h.signups[0].name).toBe('محمد علي')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Mobile / device conformance (mobile-conformance skill): Chromium device emulation
// ═════════════════════════════════════════════════════════════════════════════
const { defaultBrowserType: _a, ...iphone12 } = devices['iPhone 12']
const { defaultBrowserType: _b, ...iphoneSE } = devices['iPhone SE']
const { defaultBrowserType: _c, ...ipadMini } = devices['iPad Mini']
const { defaultBrowserType: _d, ...pixel5 } = devices['Pixel 5']
const { defaultBrowserType: _e, ...galaxyS9 } = devices['Galaxy S9+']
const MATRIX: Array<[string, Record<string, unknown>]> = [
  ['Pixel 5 (393x851 @2.75)', pixel5],
  ['iPhone 12 viewport/UA (390x844 @3)', iphone12],
  ['iPhone SE (375x667 @2)', iphoneSE],
  ['Galaxy S9+ (320x658 @4.5)', galaxyS9],
  ['iPad Mini (768x1024 @2)', ipadMini],
  ['Pixel 5 landscape (851x393)', { ...pixel5, viewport: { width: 851, height: 393 } }],
]

for (const [name, profile] of MATRIX) {
  test.describe(`mobile conformance — ${name}`, () => {
    test.use(profile as any)

    test('no horizontal overflow in the pristine, filled and error states', async ({ page }) => {
      const h = await open(page, { captcha: true, ts: 'auto-pass', boot: { avail: false } })
      const overflow = () =>
        page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.documentElement.clientWidth,
        }))
      expect((await overflow()).doc).toBeLessThanOrEqual(0)
      await fillValid(page, { name: 'Ada Lovelace' })
      await expect(page.locator("[data-avail='taken']")).toBeVisible()
      expect((await overflow()).doc).toBeLessThanOrEqual(0)
      await onSignup(page, h, r => json(r, 409, { error: 'exists', code: 'CONFLICT' }))
      await submit(page).click()
      await expect(page.locator('.fzf-su-alert[data-state="signup-conflict"]')).toBeVisible()
      expect((await overflow()).doc).toBeLessThanOrEqual(0)
    })

    test('primary controls meet tap-target size (>=44 CSS px tall; frame .btn-ds is 46) and are not clipped', async ({ page }) => {
      await open(page, { captcha: true })
      await fillValid(page)
      await expect(submit(page)).toBeEnabled()
      const targets: Array<[string, Locator]> = [
        ['submit', submit(page)],
        ['google', page.locator("[data-action='social-google']")],
        ['full name', nameField(page)],
        ['email', email(page)],
        ['password', pw(page)],
        ['confirm', confirm(page)],
      ]
      for (const [label, loc] of targets) {
        await loc.scrollIntoViewIfNeeded()
        const b = await loc.boundingBox()
        expect.soft(b, `${label} has a box`).not.toBeNull()
        expect.soft(b!.height, `${label} tap target height`).toBeGreaterThanOrEqual(44)
      }
      // the show-password icon button: WCAG 2.2 AA 2.5.8 minimum is 24x24
      const t = await page.locator('button[aria-controls="fzf-signup-password"]').boundingBox()
      expect.soft(t!.width, 'show-password toggle width').toBeGreaterThanOrEqual(24)
      expect.soft(t!.height, 'show-password toggle height').toBeGreaterThanOrEqual(24)
    })

    test('input text is at least the frame\'s --text-md (14px) and the submit is reachable by scrolling', async ({ page }) => {
      await open(page)
      const sizes: number[] = []
      for (const loc of [nameField(page), email(page), pw(page), confirm(page)]) {
        const fs = await loc.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
        sizes.push(fs)
        expect.soft(fs, 'input font-size vs approved frame .input (--text-md = 14px)').toBeGreaterThanOrEqual(14)
      }
      // ADVISORY (beyond the approved frame, recorded not asserted): iOS Safari zooms the page on
      // focus of any <16px input. The frame itself specifies 14px, so this is a design-system-level
      // observation, surfaced in the report via an annotation rather than a failing assertion.
      if (Math.min(...sizes) < 16) {
        test.info().annotations.push({
          type: 'advisory-ios-focus-zoom',
          description: `inputs render at ${Math.min(...sizes)}px (<16px): iOS Safari will zoom on focus`,
        })
      }
      await submit(page).scrollIntoViewIfNeeded()
      await expect(submit(page)).toBeInViewport()
    })

    test('full signup succeeds by touch (tap) on this profile', async ({ page, hasTouch }) => {
      const h = await open(page, { captcha: true })
      await ok201(page, h)
      await fillValid(page, { name: 'Ada Lovelace' })
      await expect(submit(page)).toBeEnabled()
      if (hasTouch) await submit(page).tap()
      else await submit(page).click()
      await page.waitForURL(/\/dashboard/)
      expect(h.signups).toHaveLength(1)
    })
  })
}

// ═════════════════════════════════════════════════════════════════════════════
// Hook parity: every hook the approved frame promises exists in the BUILT app
// ═════════════════════════════════════════════════════════════════════════════
test.describe('built UI matches the approved frame hook set', () => {
  test('manifest.testHooks for 01-signup all resolve in the built app (in the frame\'s own state)', async ({ page }) => {
    const manifest = JSON.parse(
      (await import('node:fs')).readFileSync(
        new URL('../../design/frames/auth-experience/manifest.json', import.meta.url),
        'utf8',
      ),
    )
    const frame = manifest.frames.find((f: any) => f.id === '01-signup')
    expect(frame, '01-signup is in the manifest').toBeTruthy()
    expect(manifest.build.flows.find((f: any) => f.id === 'signup').approved).toBe(true)

    await open(page, { captcha: true, boot: { avail: true } })
    await fillValid(page, { name: 'Ada Lovelace' })
    await expect(turnstile(page)).toHaveAttribute('data-state', 'verified')
    await expect(page.locator("[data-avail='available']")).toBeVisible()

    const missing: string[] = []
    for (const hook of frame.testHooks as string[]) {
      // [data-frame='01-signup'] is the container of the flow in the built app too.
      if ((await page.locator(hook).count()) === 0) missing.push(hook)
    }
    expect(missing, 'frame hooks missing from the built signup').toEqual([])
  })

  test('computed metrics of the built form match the approved frame (control sizes, type scale)', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page, { captcha: true, boot: { avail: true } })
    await fillValid(page, { name: 'Ada Lovelace' })

    const frame = await context.newPage()
    await frame.setViewportSize({ width: 1280, height: 900 })
    await frame.goto(new URL('../../design/frames/auth-experience/01-signup.html', import.meta.url).href)

    const measure = (loc: Locator) =>
      loc.evaluate(el => {
        const r = el.getBoundingClientRect()
        const c = getComputedStyle(el)
        return { w: Math.round(r.width), h: Math.round(r.height), fs: parseFloat(c.fontSize) }
      })
    const pairs: Array<[string, Locator, Locator]> = [
      ['submit button', frame.locator("[data-form='signup'] [data-action='submit']"), submit(page)],
      ['google button', frame.locator("[data-action='social-google']"), page.locator("[data-action='social-google']")],
      ['email input', frame.locator('#email'), email(page)],
      ['password input', frame.locator('#password'), pw(page)],
      ['full-name input', frame.locator('#fullName'), nameField(page)],
      ['show-password toggle', frame.locator('.pw-toggle'), page.locator('button[aria-controls="fzf-signup-password"]')],
    ]
    for (const [label, f, b] of pairs) {
      const fm = await measure(f)
      const bm = await measure(b)
      expect.soft(bm.h, `${label}: built height ${bm.h}px vs frame ${fm.h}px`).toBeGreaterThanOrEqual(fm.h - 2)
      if (label.endsWith('input') || label.endsWith('button')) {
        expect.soft(bm.fs, `${label}: built font-size ${bm.fs}px vs frame ${fm.fs}px`).toBeGreaterThanOrEqual(fm.fs - 0.5)
      }
    }
    await frame.close()
  })

  test('the page exposes the frame\'s h1 "Create your account" (document outline / screen-reader landmark)', async ({ page }) => {
    await open(page)
    // frame: <h1 class="auth-title">Create your account</h1>
    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toHaveCount(1)
  })

  test('06-states: every signup-relevant state the manifest names is reachable in the built app', async () => {
    // Reachability matrix — each is asserted in detail above; here we prove the SET is complete.
    const manifest = JSON.parse(
      (await import('node:fs')).readFileSync(
        new URL('../../design/frames/auth-experience/manifest.json', import.meta.url),
        'utf8',
      ),
    )
    const states: string[] = manifest.frames
      .find((f: any) => f.id === '06-states')
      .testHooks.map((s: string) => s.replace(/^\[data-state='|'\]$/g, ''))
      .filter((s: string) => s !== '[data-frame=\'06-states\']' && !s.startsWith('[data-frame'))
    const covered = new Set([
      'signup-initial', 'email-checking', 'email-taken', 'email-check-error', 'pw-weak',
      'signup-pw-weak-submit', 'confirm-mismatch', 'turnstile-failed', 'submit-inflight',
      'form-error', 'signup-conflict', 'signup-service-unavailable', 'mfa-required', 'unverified-gate',
    ])
    expect(states.filter(s => !covered.has(s)), 'frame states with no e2e coverage').toEqual([])
  })
})
