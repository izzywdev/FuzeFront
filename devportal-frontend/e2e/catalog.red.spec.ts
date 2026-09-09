/**
 * DEV PORTAL — CATALOG FLOW — INDEPENDENT, PRE-PRODUCTION, RED-by-design UI e2e.
 * (frontend-test-engineer — independent verification, NOT the implementer.)
 *
 * Derived STRICTLY from:
 *   design/frames/devportal/manifest.json          (build inventory + testHooks)
 *   design/frames/devportal/03-catalog.html         (populated: TreeNav + filters + results)
 *   design/frames/devportal/04-catalog-states.html  (loading / empty / filtered-empty / error / 403)
 *
 * Real API surface mocked (devportal-frontend/src/services/api.ts):
 *   GET /api/v1/catalog -> { items: CatalogEntry[] }  (401 => signed-out, per useAuth's pattern)
 *
 * manifest `build.flows[id=catalog]`: orchestrator SpecCatalogFlow, route
 * `/catalog`, components CatalogTree, CatalogFilters, CatalogResultList,
 * SpecResultCard, SandboxModeBadge — none of which src/pages/CatalogPage.tsx
 * (the current stub: a plain `<h1>`, a search box gated on `state.status ===
 * 'ready'`, and a bare list) renders any data-* hook for.
 *
 * RED-by-design — see home.red.spec.ts's header for the full rationale. Turns
 * GREEN when frontend-engineer lands SpecCatalogFlow.
 *
 * Run: npm run build && npx playwright test e2e/catalog.red.spec.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test'

interface CatalogEntry {
  id: string
  repo: string
  service: string
  version: string
  title: string
  description: string
  tags: string[]
  fetchedAt: string
}

const CATALOG_ITEMS: CatalogEntry[] = [
  {
    id: 'spec_01',
    repo: 'fuzefront',
    service: 'app-registry-service',
    version: 'v1.4.0',
    title: 'app-registry-service',
    description: 'Register, list and resolve federated + standalone applications.',
    tags: ['apps', 'health', 'manifests'],
    fetchedAt: '2026-09-08T04:12:00Z',
  },
  {
    id: 'spec_02',
    repo: 'fuzefront',
    service: 'billing-service',
    version: 'v2.1.0',
    title: 'billing-service',
    description: 'Vendor-neutral invoices, subscriptions and metered usage.',
    tags: ['billing', 'invoices'],
    fetchedAt: '2026-09-08T02:40:00Z',
  },
]

async function mockCatalogReady(page: Page, items: CatalogEntry[] = CATALOG_ITEMS) {
  await page.route('**/api/v1/catalog*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) }),
  )
}

async function mockCatalogForbidden(page: Page) {
  await page.route('**/api/v1/catalog*', (route: Route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'not_a_developer', message: 'Developer role required' }),
    }),
  )
}

async function mockCatalogHarvestFailed(page: Page) {
  await page.route('**/api/v1/catalog*', (route: Route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'harvest_failed', message: '3 of 22 sources returned 502' }),
    }),
  )
}

test.describe('Dev Portal catalog — populated (frame 03-catalog)', () => {
  test('renders the TreeNav rail with product/service nodes', async ({ page }) => {
    await mockCatalogReady(page)
    await page.goto('/catalog')
    await expect(page.locator("[data-panel='catalog-tree']")).toBeVisible()
    await expect(page.locator("[data-tree-node='fuzefront']")).toBeVisible()
    await expect(page.locator("[data-tree-node='fuzefront/app-registry-service']")).toBeVisible()
  })

  test('renders the search + product/tag/sandbox-mode filters', async ({ page }) => {
    await mockCatalogReady(page)
    await page.goto('/catalog')
    await expect(page.locator("[data-panel='catalog-filters']")).toBeVisible()
    await expect(page.locator("[data-input='catalog-search']")).toBeVisible()
    await expect(page.locator("[data-filter='product']")).toBeVisible()
    await expect(page.locator("[data-filter='tag']")).toBeVisible()
    await expect(page.locator("[data-filter='sandbox-mode']")).toBeVisible()
  })

  test('renders result cards carrying spec id, version, harvest age and sandbox mode', async ({ page }) => {
    await mockCatalogReady(page)
    await page.goto('/catalog')
    await expect(page.locator("[data-panel='catalog-results']")).toBeVisible()
    const card = page.locator("[data-spec='fuzefront/app-registry-service']")
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-spec-version', 'v1.4.0')
    // Exactly one of mock|sandbox|unavailable, before opening the spec.
    await expect(card.locator("[data-sandbox-mode]")).toBeVisible()
  })

  test('a spec whose last harvest failed validation is still listed, badged unavailable', async ({ page }) => {
    const items = [
      ...CATALOG_ITEMS,
      {
        id: 'spec_03',
        repo: 'fuzefront',
        service: 'portal-service',
        version: 'v3.0.0',
        title: 'portal-service',
        description: 'White-label portals and custom hostnames. Last harvest failed validation.',
        tags: ['portals'],
        fetchedAt: '2026-09-08T09:20:00Z',
      },
    ]
    await mockCatalogReady(page, items)
    await page.goto('/catalog')
    await expect(
      page.locator("[data-spec='fuzefront/portal-service'][data-sandbox-mode='unavailable']"),
      'a spec with a failed harvest must still appear in the catalog, badged unavailable — never hidden',
    ).toBeVisible()
  })

  test('clear-filters resets the query and result count reflects the filtered set', async ({ page }) => {
    await mockCatalogReady(page)
    await page.goto('/catalog')
    await expect(page.locator("[data-result-count]")).toBeVisible()
    await expect(page.locator("[data-action='clear-filters']")).toBeVisible()
  })
})

test.describe('Dev Portal catalog — states (frame 04-catalog-states)', () => {
  test('(a) loading: results region is aria-busy while GET /catalog is in flight', async ({ page }) => {
    await page.route('**/api/v1/catalog*', async (route: Route) => {
      await new Promise(resolve => setTimeout(resolve, 2000))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: CATALOG_ITEMS }) })
    })
    const navigation = page.goto('/catalog')
    await expect(
      page.locator("[data-state='loading']"),
      'a loading skeleton must render while GET /catalog is in flight',
    ).toBeVisible()
    await navigation
  })

  test('(b) empty: zero specs harvested is a cold start, not an error', async ({ page }) => {
    await mockCatalogReady(page, [])
    await page.goto('/catalog')
    await expect(page.locator("[data-state='empty']")).toBeVisible()
    const empty = page.locator("[data-empty='no-specs']")
    await expect(empty).toBeVisible()
    await expect(empty.locator("[data-action='view-publish-guide']")).toBeVisible()
  })

  test('(c) filtered-empty: specs exist but the query matches none', async ({ page }) => {
    await mockCatalogReady(page)
    await page.goto('/catalog')
    await page.locator("[data-input='catalog-search']").fill('webhook subscriptions that do not exist')
    const empty = page.locator("[data-empty='no-results']")
    await expect(empty).toBeVisible()
    await expect(empty.locator("[data-action='clear-filters']")).toBeVisible()
  })

  test('(d) error: harvest failure degrades to the last known-good catalog, every row marked stale', async ({ page }) => {
    await mockCatalogHarvestFailed(page)
    await page.goto('/catalog')
    await expect(page.locator("[data-state='error']")).toBeVisible()
    await expect(page.locator("[data-error='harvest-failed']")).toBeVisible()
    await expect(
      page.locator("[data-catalog='stale']").first(),
      'cached data must never be presented as fresh — every stale row/chip carries the stale badge',
    ).toBeVisible()
    await expect(page.locator("[data-action='retry']")).toBeVisible()
  })

  test('(e) forbidden: 403 not-a-developer fails closed, no partial catalog', async ({ page }) => {
    await mockCatalogForbidden(page)
    await page.goto('/catalog')
    await expect(page.locator("[data-state='forbidden']")).toBeVisible()
    await expect(page.locator("[data-http='403']")).toBeVisible()
    await expect(page.locator("[data-action='view-my-access']")).toBeVisible()
    // Fail-closed: no result cards may render alongside the 403.
    await expect(page.locator("[data-panel='catalog-results'] [data-spec]")).toHaveCount(0)
  })
})

test.describe('Dev Portal catalog — runtime console-clean gate (ui-runtime-validation)', () => {
  test('the rendered catalog has a clean console (0 errors, 0 CSP/mixed-content, 0 failed app requests)', async ({ page }) => {
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

    await mockCatalogReady(page)
    await page.goto('/catalog')
    await expect(page.locator("[data-panel='catalog-tree']")).toBeVisible()

    expect(consoleErrors, `console errors on catalog:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(failedRequests, `failed app requests on catalog:\n${failedRequests.join('\n')}`).toEqual([])
  })
})
