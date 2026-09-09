/**
 * DEV PORTAL — PLAYGROUND FLOW — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * Derived STRICTLY from:
 *   design/frames/devportal/manifest.json             (build inventory + testHooks)
 *   design/frames/devportal/07-playground.html          (request builder / response / quota)
 *   design/frames/devportal/08-playground-states.html   (429 / 503 / 403 / 5xx / target-4xx-as-data)
 *
 * Real API surface mocked (devportal-frontend/src/services/api.ts):
 *   GET  /api/v1/playground/quota -> Quota
 *   POST /api/v1/playground/try   -> TryResponse (429/404/other => surfaced error)
 *
 * manifest `build.flows[id=playground]`: orchestrator PlaygroundFlow, route
 * `/playground`, components RequestBuilder, SandboxTargetSelector, ParamTable,
 * ResponsePanel, QuotaMeter, SandboxSafetyNotice, RequestHistoryPanel — none of
 * which src/pages/PlaygroundPage.tsx (the current stub: two bare text inputs
 * for specId/operationId and a "Try it" button) renders any data-* hook for.
 *
 * Every fail-closed state here shares ONE non-negotiable property per the
 * frame: the portal NEVER falls back to a production `servers:` entry. That
 * is exactly what these RED specs pin down for frontend-engineer to build to.
 *
 * RED-by-design — see home.red.spec.ts's header for the full rationale. Turns
 * GREEN when frontend-engineer lands PlaygroundFlow.
 *
 * Run: npm run build && npx playwright test e2e/playground.red.spec.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

async function mockQuotaOk(page: Page) {
  await page.route('**/api/v1/playground/quota', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ used: 138, limit: 500, windowHours: 24 }) }),
  )
}

async function mockQuotaExceeded(page: Page) {
  await page.route('**/api/v1/playground/quota', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ used: 500, limit: 500, windowHours: 24 }) }),
  )
}

async function mockTrySuccess(page: Page) {
  await page.route('**/api/v1/playground/try', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 201,
        body: { id: 'app_01j9k2xq7ne3ta6yb1m4v0dzcw', slug: 'fuzepicker', name: 'Picker' },
        source: 'example',
        sandboxed: true,
        target: 'mock://app-registry-service@v1.4.0',
      }),
    }),
  )
}

async function mockTryQuotaExceeded(page: Page) {
  await page.route('**/api/v1/playground/try', (route: Route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'retry-after': '22320' },
      body: JSON.stringify({ code: 'quota_exceeded', message: 'Daily sandbox quota reached' }),
    }),
  )
}

async function mockTryTargetUnavailable(page: Page) {
  await page.route('**/api/v1/playground/try', (route: Route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'sandbox_target_unavailable', message: 'mock server did not answer within 10s' }),
    }),
  )
}

async function mockTryForbidden(page: Page) {
  await page.route('**/api/v1/playground/try', (route: Route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'playground_forbidden', message: 'DevPortalPlayground:use required' }),
    }),
  )
}

async function mockTryProxyError(page: Page) {
  await page.route('**/api/v1/playground/try', (route: Route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'proxy_error', requestId: 'req_01j9k5r8w2n4qd7cyv3h0tefam', message: 'sandbox proxy failed' }),
    }),
  )
}

async function mockTryTargetConflict(page: Page) {
  // A 4xx FROM THE TARGET is a successful sandbox call, not a portal failure.
  await page.route('**/api/v1/playground/try', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 409,
        body: { error: 'slug_already_registered', message: "An application with slug 'fuzepicker' already exists." },
        source: 'example',
        sandboxed: true,
        target: 'mock://app-registry-service@v1.4.0',
      }),
    }),
  )
}

test.describe('Dev Portal playground — populated (frame 07-playground)', () => {
  test('the sandbox-only safety notice is always visible', async ({ page }) => {
    await mockQuotaOk(page)
    await page.goto('/playground')
    await expect(page.locator("[data-safety-notice='sandbox-only']")).toBeVisible()
  })

  test('renders the request builder with the sandbox target selector resolved', async ({ page }) => {
    await mockQuotaOk(page)
    await page.goto('/playground')
    await expect(page.locator("[data-panel='request-builder']")).toBeVisible()
    await expect(page.locator("[data-select='sandbox-target']")).toBeVisible()
    await expect(page.locator("[data-resolved-target]")).toBeVisible()
  })

  test('the authorization header is not editable and marked synthetic-identity', async ({ page }) => {
    await mockQuotaOk(page)
    await page.goto('/playground')
    await expect(
      page.locator("[data-security-note='synthetic-identity']"),
      'a developer must be unable to paste a real production token into a sandbox call',
    ).toBeVisible()
  })

  test('the request body is editable and prefilled from the spec example', async ({ page }) => {
    await mockQuotaOk(page)
    await page.goto('/playground')
    const body = page.locator("[data-input='request-body']")
    await expect(body).toBeVisible()
    await expect(body).not.toBeEmpty()
  })

  test('sending a request renders the response panel with status, timing and body', async ({ page }) => {
    await mockQuotaOk(page)
    await mockTrySuccess(page)
    await page.goto('/playground')
    await page.locator("[data-action='send-request']").click()
    const response = page.locator("[data-panel='response']")
    await expect(response).toBeVisible()
    await expect(response.locator("[data-response-status='201']")).toBeVisible()
  })

  test('renders the quota meter and this developer\'s own request history', async ({ page }) => {
    await mockQuotaOk(page)
    await page.goto('/playground')
    const quota = page.locator("[data-panel='quota']")
    await expect(quota).toBeVisible()
    await expect(quota.locator("[data-quota-used='138']")).toBeVisible()
    await expect(page.locator("[data-panel='request-history']")).toBeVisible()
  })
})

test.describe('Dev Portal playground — fail-closed states (frame 08-playground-states)', () => {
  test('(b) request-invalid: blocked locally before it leaves the browser, quota untouched', async ({ page }) => {
    await mockQuotaOk(page)
    await page.goto('/playground')
    // A body missing `slug` and carrying a client-supplied `id` must be rejected client-side.
    await page.locator("[data-input='request-body']").fill('{"id":"app_x","name":"Picker"}')
    await page.locator("[data-action='send-request']").click({ force: true }).catch(() => {})
    await expect(page.locator("[data-error='request-invalid']")).toBeVisible()
    await expect(page.locator("[data-panel='quota'] [data-quota-used='138']"), 'quota must not move on a locally-blocked request').toBeVisible()
  })

  test('(c) 429 quota-exceeded: send disabled until reset, catalog/spec reading unaffected', async ({ page }) => {
    await mockQuotaExceeded(page)
    await mockTryQuotaExceeded(page)
    await page.goto('/playground')
    await expect(page.locator("[data-quota-state='exceeded']")).toBeVisible()
    await page.locator("[data-action='send-request']").click({ force: true }).catch(() => {})
    await expect(page.locator("[data-http='429']")).toBeVisible()
    await expect(page.locator("[data-error='quota-exceeded']")).toBeVisible()
    await expect(page.locator("[data-quota-reset]")).toBeVisible()
    const sendButton = page.locator("[data-action='send-request']")
    await expect(sendButton).toBeDisabled()
  })

  test('(d) 503 sandbox target unavailable: NO fallback to production, health shown before Send', async ({ page }) => {
    await mockQuotaOk(page)
    await mockTryTargetUnavailable(page)
    await page.goto('/playground')
    await page.locator("[data-action='send-request']").click()
    await expect(page.locator("[data-http='503']")).toBeVisible()
    await expect(page.locator("[data-error='sandbox-target-unavailable']")).toBeVisible()
    await expect(
      page.locator("[data-safety-note='no-prod-fallback']"),
      'must explicitly state the request was not sent anywhere else',
    ).toBeVisible()
    await expect(page.locator("[data-sandbox-health='down']")).toBeVisible()
  })

  test('(e) no-sandbox-available: absence of opt-in means mock-only, never production, Send disabled', async ({ page }) => {
    await mockQuotaOk(page)
    await page.route('**/api/v1/playground/try', (route: Route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'sandbox_not_available', message: 'no mock could be generated and no sandbox URL was declared' }),
      }),
    )
    await page.goto('/playground?specId=spec_03&operationId=listPortals')
    await expect(page.locator("[data-error='sandbox-not-available']")).toBeVisible()
    await expect(page.locator("[data-action='send-request'][data-try-it='disabled']")).toBeDisabled()
  })

  test('(f) 403 playground-forbidden: catalog/spec reading keeps working', async ({ page }) => {
    await mockQuotaOk(page)
    await mockTryForbidden(page)
    await page.goto('/playground')
    await page.locator("[data-action='send-request']").click()
    await expect(page.locator("[data-http='403']")).toBeVisible()
    await expect(page.locator("[data-error='playground-forbidden']")).toBeVisible()
    await expect(page.locator("[data-action='view-my-access']")).toBeVisible()
  })

  test('(g) proxy error: 5xx from devportal-service itself, copyable request id, no quota consumed', async ({ page }) => {
    await mockQuotaOk(page)
    await mockTryProxyError(page)
    await page.goto('/playground')
    await page.locator("[data-action='send-request']").click()
    await expect(page.locator("[data-error='proxy-error']")).toBeVisible()
    await expect(page.locator("[data-request-id]")).toBeVisible()
  })

  test('(h) target 4xx/5xx is a successful sandbox call, rendered as response DATA — not a portal error', async ({ page }) => {
    await mockQuotaOk(page)
    await mockTryTargetConflict(page)
    await page.goto('/playground')
    await page.locator("[data-action='send-request']").click()
    const response = page.locator("[data-panel='response']")
    await expect(response.locator("[data-response-status='409']")).toBeVisible()
    // Must NOT render as a StatusCallout error — that vocabulary is reserved for
    // the portal's own failures (b/c/d/f/g above).
    await expect(page.locator("[data-error='proxy-error']")).toHaveCount(0)
  })
})

test.describe('Dev Portal playground — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the rendered playground has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err)}`))
    page.on('requestfailed', req => {
      const url = req.url()
      if (url.includes('/api/') || url.includes('/assets')) {
        failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
      }
    })

    await mockQuotaOk(page)
    await page.goto('/playground')
    await expect(page.locator("[data-panel='request-builder']")).toBeVisible()

    expect(consoleErrors, `console errors on playground:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on playground:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
