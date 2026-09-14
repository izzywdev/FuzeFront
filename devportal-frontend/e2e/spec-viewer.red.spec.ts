/**
 * DEV PORTAL — SPEC VIEWER FLOW — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * Derived STRICTLY from:
 *   design/frames/devportal/manifest.json               (build inventory + testHooks)
 *   design/frames/devportal/05-spec-viewer.html           (overview + embedded OpenAPI render)
 *   design/frames/devportal/06-spec-viewer-states.html    (loading / 502 / invalid / 404 / stale)
 *
 * Real API surface mocked (devportal-frontend/src/services/api.ts):
 *   GET /api/v1/catalog/{repo}/{service} -> SpecRecord (404 => not found)
 *
 * manifest `build.flows[id=spec-viewer]`: orchestrator SpecViewerFlow, route
 * `/catalog/:product/:service` (the current App.tsx stub wires the structurally
 * equivalent `/catalog/:repo/:service`), components SpecHeader,
 * SpecOverviewPanel, EndpointList, OperationPanel, SchemaTable,
 * SpecRendererEmbed, CodeSamplePanel — none of which src/pages/SpecViewerPage.tsx
 * (the current stub: a plain operations list with no data-* hooks) renders.
 *
 * RED-by-design — see home.red.spec.ts's header for the full rationale. Turns
 * GREEN when frontend-engineer lands SpecViewerFlow.
 *
 * Run: npm run build && npx playwright test e2e/spec-viewer.red.spec.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const SPEC_ROUTE = '/catalog/fuzefront/app-registry-service'

const VALID_SPEC_RECORD = {
  id: 'spec_01',
  repo: 'fuzefront',
  service: 'app-registry-service',
  specPath: 'services/app-registry-service/openapi.yaml',
  version: 'v1.4.0',
  fetchedAt: '2026-09-08T04:12:00Z',
  rawSpec: {
    openapi: '3.1.0',
    info: { title: 'app-registry-service', description: 'Registers and resolves applications mounted into the shell.' },
    paths: {
      '/api/v1/apps': {
        post: {
          operationId: 'registerApp',
          summary: 'Register an application',
          tags: ['apps'],
          responses: { '201': {}, '400': {}, '409': {} },
        },
      },
    },
  },
}

async function mockSpecReady(page: Page) {
  await page.route('**/api/v1/catalog/fuzefront/app-registry-service', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VALID_SPEC_RECORD) }),
  )
}

async function mockSpecFetchFailed(page: Page) {
  await page.route('**/api/v1/catalog/fuzefront/app-registry-service', (route: Route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'upstream storage unreachable' }) }),
  )
}

async function mockSpecNotFound(page: Page) {
  await page.route('**/api/v1/catalog/fuzefront/legacy-portal-api', (route: Route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'spec not found' }) }),
  )
}

test.describe('Dev Portal spec viewer — populated (frame 05-spec-viewer)', () => {
  test('renders the spec header with product/service/version/source provenance', async ({ page }) => {
    await mockSpecReady(page)
    await page.goto(SPEC_ROUTE)
    const header = page.locator("[data-panel='spec-header']")
    await expect(header).toBeVisible()
    await expect(header).toHaveAttribute('data-spec', 'fuzefront/app-registry-service')
    await expect(header.locator("[data-spec-version='v1.4.0']")).toBeVisible()
    await expect(header.locator("[data-source-repo]")).toBeVisible()
  })

  test('renders the aggregated overview panel we own', async ({ page }) => {
    await mockSpecReady(page)
    await page.goto(SPEC_ROUTE)
    await expect(page.locator("[data-panel='spec-overview']")).toBeVisible()
  })

  test('renders the endpoint list grouped by tag, with the selected operation', async ({ page }) => {
    await mockSpecReady(page)
    await page.goto(SPEC_ROUTE)
    await expect(page.locator("[data-panel='endpoint-list']")).toBeVisible()
    await expect(page.locator("[data-operation='registerApp']").first()).toBeVisible()
  })

  test('renders request and response schemas for the selected operation, including non-2xx', async ({ page }) => {
    await mockSpecReady(page)
    await page.goto(SPEC_ROUTE)
    await expect(page.locator("[data-panel='operation']")).toBeVisible()
    await expect(page.locator("[data-panel='request-schema']")).toBeVisible()
    const responses = page.locator("[data-panel='response-schema']")
    await expect(responses).toBeVisible()
    // 4xx/5xx must be shown too — not just the 2xx.
    await expect(responses).toContainText('409')
  })

  test('renders copy-paste code samples and the try-it actions', async ({ page }) => {
    await mockSpecReady(page)
    await page.goto(SPEC_ROUTE)
    await expect(page.locator("[data-panel='code-sample']")).toBeVisible()
    await expect(page.locator("[data-action='try-it']").first()).toBeVisible()
    await expect(page.locator("[data-action='try-it-operation']").first()).toBeVisible()
    await expect(page.locator("[data-action='download-spec']")).toBeVisible()
  })
})

test.describe('Dev Portal spec viewer — states (frame 06-spec-viewer-states)', () => {
  test('(a) loading: skeletons render while the spec blob is being fetched', async ({ page }) => {
    await page.route('**/api/v1/catalog/fuzefront/app-registry-service', async (route: Route) => {
      await new Promise(resolve => setTimeout(resolve, 2000))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VALID_SPEC_RECORD) })
    })
    const navigation = page.goto(SPEC_ROUTE)
    await expect(page.locator("[data-state='loading']")).toBeVisible()
    await navigation
  })

  test('(b) fetch failed: 502 states this is not an account problem and offers retry', async ({ page }) => {
    await mockSpecFetchFailed(page)
    await page.goto(SPEC_ROUTE)
    await expect(page.locator("[data-state='error']")).toBeVisible()
    await expect(page.locator("[data-error='spec-fetch-failed']")).toBeVisible()
    await expect(page.locator("[data-http='502']")).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
    await expect(page.locator("[data-action='back-to-catalog']")).toBeVisible()
  })

  test('(c) invalid spec: renderer replaced by validator output, Try-it disabled-and-visible, not hidden', async ({ page }) => {
    await page.route('**/api/v1/catalog/fuzefront/portal-service', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'spec_03',
          repo: 'fuzefront',
          service: 'portal-service',
          specPath: 'services/portal-service/openapi.yaml',
          version: 'v3.0.0',
          fetchedAt: '2026-09-08T07:31:00Z',
          valid: false,
          validationErrors: ['paths./portals/{portalId}.get.responses: Property "200" must have required property "description"'],
          rawSpec: { openapi: '3.1.0', info: { title: 'portal-service' } },
        }),
      }),
    )
    await page.goto('/catalog/fuzefront/portal-service')
    await expect(page.locator("[data-state='invalid-spec']")).toBeVisible()
    await expect(page.locator("[data-error='spec-invalid']")).toBeVisible()
    await expect(page.locator("[data-spec-validity='invalid']")).toBeVisible()
    await expect(page.locator("[data-code='validation-errors']")).toBeVisible()
    const tryIt = page.locator("[data-action='try-it'][data-try-it='disabled']")
    await expect(
      tryIt,
      'Try-it must be DISABLED and VISIBLE on an invalid spec — a request builder from a half-parsed spec would target operations that do not exist',
    ).toBeVisible()
    await expect(tryIt).toBeDisabled()
    await expect(page.locator("[data-action='report-to-source-repo']")).toBeVisible()
    await expect(page.locator("[data-action='view-last-valid']")).toBeVisible()
  })

  test('(d) not found: 404 for a removed/renamed spec', async ({ page }) => {
    await mockSpecNotFound(page)
    await page.goto('/catalog/fuzefront/legacy-portal-api')
    await expect(page.locator("[data-state='not-found']")).toBeVisible()
    await expect(page.locator("[data-empty='spec-not-found']")).toBeVisible()
    await expect(page.locator("[data-http='404']")).toBeVisible()
    await expect(page.locator("[data-action='back-to-catalog']")).toBeVisible()
  })

  test('(e) stale: renders normally but badges age rather than hiding it', async ({ page }) => {
    await page.route('**/api/v1/catalog/fuzefront/app-registry-service', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...VALID_SPEC_RECORD, fetchedAt: '2026-08-05T00:00:00Z' }),
      }),
    )
    await page.goto(SPEC_ROUTE)
    await expect(page.locator("[data-state='stale']")).toBeVisible()
    await expect(page.locator("[data-catalog='stale']")).toBeVisible()
    // The rest of the doc must still render — staleness is marked, not a substitute for content.
    await expect(page.locator("[data-panel='spec-overview']")).toBeVisible()
  })
})

test.describe('Dev Portal spec viewer — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the rendered spec viewer has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
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

    await mockSpecReady(page)
    await page.goto(SPEC_ROUTE)
    await expect(page.locator("[data-panel='spec-header']")).toBeVisible()

    expect(consoleErrors, `console errors on spec viewer:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on spec viewer:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
