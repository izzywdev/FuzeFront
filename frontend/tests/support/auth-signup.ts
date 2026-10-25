/**
 * Shared harness for the auth-experience SIGNUP e2e (flag `fuzefront.auth.experience`).
 *
 * Everything here is a mocked-TRANSPORT harness: the real built host UI
 * (`frontend/` -> LoginPage -> `@fuzefront/auth-ui` SignUpFlow) runs in a real
 * Chromium, and only the same-origin Security API (`/api/v1/security/*`) and the
 * Cloudflare Turnstile script are intercepted. No backing stack is required.
 *
 * Turnstile: the real widget needs `challenges.cloudflare.com`, which is not
 * reachable from every CI/sandbox network and is by design non-deterministic.
 * `stubTurnstile()` therefore replaces ONLY the Cloudflare `api.js` with a tiny
 * implementation of the documented `window.turnstile` surface that drives the
 * SAME `@marsidev/react-turnstile` wrapper + `TurnstileField` callbacks as the
 * real script does. The site key used is Cloudflare's published TEST key.
 */
import type { Page, Route, ConsoleMessage, Request, Response } from '@playwright/test'

/** Cloudflare's published always-passes TEST site key (never a production key). */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
/** Cloudflare's published always-fails TEST site key (visible widget that errors). */
export const TURNSTILE_TEST_SITE_KEY_FAIL = '2x00000000000000000000AB'
/** What the stub (and Cloudflare's test secret flow) hands back as the token. */
export const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

export const SEC = '**/v1/security'

/** A password that satisfies the default 12+/upper/lower/digit/symbol policy. */
export const STRONG = 'Corr3ct-Horse!Batt'
/** Fails every rule except lowercase (matches frame `pw-weak`). */
export const WEAK = 'abc'

export const POLICY = {
  minLength: 12,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true,
}

export const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: body === undefined ? '' : JSON.stringify(body),
  })

export interface MethodsOpts {
  /** Include `AuthMethods.captcha` (Turnstile required). Default false. */
  captcha?: boolean
  siteKey?: string
  /** Include `AuthMethods.passwordPolicy`. Default true. */
  policy?: boolean
  social?: string[]
  verificationEmail?: boolean
}

export function methodsBody(o: MethodsOpts = {}) {
  return {
    password: true,
    social: o.social ?? ['google'],
    mfa: { enabled: false, types: [] },
    verification: { email: o.verificationEmail ?? false, sms: false },
    ...(o.policy === false ? {} : { passwordPolicy: POLICY }),
    ...(o.captcha
      ? { captcha: { provider: 'turnstile', siteKey: o.siteKey ?? TURNSTILE_TEST_SITE_KEY } }
      : {}),
  }
}

export type TurnstileMode = 'auto-pass' | 'manual' | 'interactive' | 'error' | 'unsupported'

/**
 * Replace Cloudflare's `api.js` with a deterministic stub of `window.turnstile`.
 *
 *  - `auto-pass`    : token delivered ~30ms after render (what the TEST site key does).
 *  - `interactive`  : fires before-interactive (a visible challenge is needed), then
 *                     passes only when the test calls `window.__ts.pass()`.
 *  - `manual`       : renders and waits; the test drives `window.__ts.pass()/fail()/expire()`.
 *  - `error`        : error-callback after render (the always-fails TEST key behaviour).
 *  - `unsupported`  : unsupported-callback after render.
 *
 * `window.__ts` exposes: renders (count), resets (count), pass(), fail(), expire(), lastOptions.
 */
export async function stubTurnstile(page: Page, mode: TurnstileMode = 'auto-pass') {
  await page.addInitScript(m => {
    ;(window as any).__TS_MODE = m
  }, mode)
  await page.route(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
(function () {
  var TOKEN = ${JSON.stringify(TURNSTILE_TEST_TOKEN)};
  var widgets = {};
  var seq = 0;
  var ts = (window.__ts = { renders: 0, resets: 0, lastOptions: null, siteKeys: [] });
  function cur() { var ks = Object.keys(widgets); return widgets[ks[ks.length - 1]]; }
  ts.pass = function () { var w = cur(); if (w && w.o.callback) w.o.callback(TOKEN); };
  ts.fail = function () { var w = cur(); if (w && w.o['error-callback']) w['o']['error-callback']('300030'); };
  ts.expire = function () { var w = cur(); if (w && w.o['expired-callback']) w.o['expired-callback'](); };
  ts.interactive = function () { var w = cur(); if (w && w.o['before-interactive-callback']) w.o['before-interactive-callback'](); };
  function drive(w) {
    var mode = window.__TS_MODE || 'auto-pass';
    setTimeout(function () {
      if (!widgets[w.id]) return;
      if (mode === 'auto-pass') w.o.callback && w.o.callback(TOKEN);
      else if (mode === 'interactive') w.o['before-interactive-callback'] && w.o['before-interactive-callback']();
      else if (mode === 'error') w.o['error-callback'] && w.o['error-callback']('300030');
      else if (mode === 'unsupported') w.o['unsupported-callback'] && w.o['unsupported-callback']();
    }, 30);
  }
  window.turnstile = {
    render: function (el, o) {
      var id = 'ts-' + (++seq);
      widgets[id] = { id: id, el: el, o: o };
      ts.renders++; ts.lastOptions = o; ts.siteKeys.push(o.sitekey);
      drive(widgets[id]);
      return id;
    },
    reset: function (id) { ts.resets++; if (widgets[id]) drive(widgets[id]); },
    remove: function (id) { delete widgets[id]; },
    getResponse: function () { return TOKEN; },
    isExpired: function () { return false; },
    execute: function () {}
  };
  if (typeof window.onloadTurnstileCallback === 'function') window.onloadTurnstileCallback();
})();
`,
    }),
  )
}

export interface BootOpts {
  /** Force `fuzefront.auth.experience` ON/OFF pre-auth (same-origin runtime override). */
  flag: boolean | null
  methods?: MethodsOpts
  /** Email-availability answer: boolean => {available}, number => that HTTP status, 'hang' => never resolves, 'drop' => network abort. */
  avail?: boolean | number | 'hang' | 'drop' | ((email: string) => boolean | number)
}

export interface Harness {
  /** Bodies of every POST /signup the app made, in order. */
  signups: Array<Record<string, unknown>>
  /** Emails of every GET /signup/email-available the app made. */
  availChecks: string[]
  /** Console errors / page errors / failed or >=400 same-app requests collected during the test. */
  problems: string[]
  /** console.warn messages (React key/DOM-nesting/act warnings etc.). */
  warnings: string[]
  /** Flip to true once the mocked signup succeeded: GET /session then answers 200 with the new user. */
  authed: boolean
}

/**
 * Unauthenticated boot with the Security API mocked. The session probe answers 401
 * (anonymous visitor), `/methods` returns the requested capability descriptor,
 * `/signup/email-available` answers per `opts.avail`. POST `/signup` is NOT mocked
 * here — each spec installs its own handler via `onSignup()` so the response (201 /
 * 409 / 503 / 429 / 400 CAPTCHA_FAILED / 422 …) is explicit in the spec.
 */
export async function boot(page: Page, opts: BootOpts): Promise<Harness> {
  const h: Harness = { signups: [], availChecks: [], problems: [], warnings: [], authed: false }

  // `flag: null` leaves the override UNSET so the build-time default (OFF) is what runs.
  if (opts.flag !== null) {
    await page.addInitScript(on => {
      ;(window as any).__FF_AUTH_EXPERIENCE__ = on
    }, opts.flag)
  }

  await page.route(`${SEC}/session`, route =>
    route.request().method() !== 'GET'
      ? route.fallback()
      : h.authed
        ? json(route, 200, { user: SIGNUP_OK.user })
        : json(route, 401, { error: 'no token', code: 'NO_TOKEN' }),
  )
  await page.route(`${SEC}/methods`, route => json(route, 200, methodsBody(opts.methods)))

  await page.route(`${SEC}/signup/email-available**`, async route => {
    const email = new URL(route.request().url()).searchParams.get('email') ?? ''
    h.availChecks.push(email)
    const a = typeof opts.avail === 'function' ? opts.avail(email) : (opts.avail ?? true)
    if (a === 'hang') return // never fulfilled
    if (a === 'drop') return route.abort('failed')
    if (typeof a === 'number') return json(route, a, { error: 'x', code: 'X' })
    return json(route, 200, { available: a })
  })

  // Problem collector (supplements — never replaces — the Chrome DevTools MCP pass).
  page.on('pageerror', e => h.problems.push(`pageerror: ${e.message}`))
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') h.problems.push(`console.error: ${m.text()}`)
    if (m.type() === 'warning') h.warnings.push(m.text())
  })
  page.on('requestfailed', (r: Request) =>
    h.problems.push(`requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`),
  )
  page.on('response', (r: Response) => {
    if (r.status() >= 400) h.problems.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`)
  })
  return h
}

/** Install a POST /signup handler; records the request body on the harness. */
export async function onSignup(
  page: Page,
  h: Harness,
  respond: (route: Route, body: Record<string, unknown>) => Promise<void> | void,
) {
  await page.route(`${SEC}/signup`, route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON() as Record<string, unknown>
    h.signups.push(body)
    return respond(route, body)
  })
}

export const SIGNUP_OK = {
  token: 'tok_new_session',
  sessionId: 'sess_1',
  user: { id: 'u_new', email: 'ada@lovelace.io', name: 'Ada Lovelace', roles: [] },
}

/**
 * Problems that are NOT attributable to the signup flow under test and are produced
 * by the intentional mocking itself (a deliberately-failed request is a 4xx/5xx the
 * spec asked for). Used by the console-clean checks on HAPPY paths only.
 */
export const BENIGN: RegExp[] = [
  // The anonymous boot probe 401s by design (mocked as an anonymous visitor).
  /http 401: GET .*\/v1\/security\/session/,
  /Failed to load resource: the server responded with a status of 401/,
  // ARTIFACT of `serviceWorkers: 'block'` (needed so page.route() mocks apply on a production
  // bundle): the blocked registration resolves undefined and workbox-window logs this. It is
  // produced by the test harness, not by the signup flow.
  /Service worker registration failed/,
]
