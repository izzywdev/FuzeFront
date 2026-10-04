import { test, expect, type Page } from '@playwright/test'
import { seedMockSession } from '../../tests/support/account-vault'
import { loginSyntheticViaApi } from '../../tests/support/post-prod-auth'

/**
 * POST-PRODUCTION smoke — the Portals directory renders in the LIVE app.
 *
 * Runs READ-ONLY against the live platform (default https://app.fuzefront.com
 * via playwright.post-prod.config.ts) in the same post-prod job that
 * `prod-post-deploy.yml` invokes after every release, so a deploy that turns
 * the Portals directory dark fails loudly.
 *
 * Two levels of coverage, deliberately split by the access each needs:
 *
 *  1. **Nav + page render — ALWAYS ON** (regular synthetic). The "Portals" nav
 *     entry is gated ONLY on the `fuzefront.platform.portals-directory` flag
 *     (SidePanel), and the flag must also be DISCLOSED to the browser via
 *     `GET /api/flags` (WEB_EXPOSED_FLAGS) or `useFlag()` silently returns its
 *     OFF default. So an authenticated session seeing the entry — and the
 *     `/portals` page mounting its panel without a runtime/MF error — proves
 *     the whole flag chain survived the deploy. This needs no privileged
 *     account. Skips loudly if POST_PROD_PASSWORD is unset (same contract as
 *     live-smoke test 7 — missing coverage, never a guessable fallback).
 *
 *  2. **List contents — the two portals** (master-admin synthetic). The
 *     directory DATA (`GET /api/v1/admin/portals`) authorizes per-portal and
 *     only a root-scoped master-admin sees the fleet, so asserting the list
 *     contains the root `fuzefront` portal AND `mendysrobotics` requires an
 *     admin account. There is no self-provision-to-admin path (the public
 *     signup grants a normal user; `/internal/provision` grants root
 *     MEMBERSHIP, not the admin ROLE the directory requires), so this is gated
 *     on a dedicated POST_PROD_ADMIN_EMAIL / POST_PROD_ADMIN_PASSWORD secret
 *     and SKIPS LOUDLY when absent rather than silently passing.
 */

const EMAIL = process.env.POST_PROD_EMAIL || 'postprod-smoke@fuzefront.com'
const PASSWORD = process.env.POST_PROD_PASSWORD
const INTERNAL_SECRET = process.env.INTERNAL_PROVISION_SECRET
const HAS_SYNTHETIC_CREDS = Boolean(PASSWORD)

// A dedicated master-admin synthetic for the list-contents assertion. Separate
// account + secret because it holds the admin role; the address is not a
// credential, so it has a stable default, but the password has no fallback.
const ADMIN_EMAIL = process.env.POST_PROD_ADMIN_EMAIL || 'postprod-admin@fuzefront.com'
const ADMIN_PASSWORD = process.env.POST_PROD_ADMIN_PASSWORD
const HAS_ADMIN_CREDS = Boolean(ADMIN_PASSWORD)

const ROOT_PORTAL_SLUG = 'fuzefront'
const MENDYS_PORTAL_SLUG = 'mendysrobotics'

interface AdminPortal {
  id: string
  slug: string
  name: string
  identity_mode?: string
  status?: string
}

function attachErrorCollectors(page: Page) {
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on('pageerror', (err: Error) => pageErrors.push(err.message))
  page.on('requestfailed', req => {
    const url = req.url()
    // Only app assets / API — ignore third-party beacons/analytics noise.
    if (/\/api\/|remoteEntry|\.js(\?|$)|\/portals/i.test(url)) {
      failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
    }
  })
  return { pageErrors, failedRequests }
}

/** Normalise the directory response to the portals array across shapes. */
function portalsFrom(body: unknown): AdminPortal[] {
  if (Array.isArray(body)) return body as AdminPortal[]
  const b = body as Record<string, unknown>
  if (Array.isArray(b?.items)) return b.items as AdminPortal[]
  if (Array.isArray(b?.portals)) return b.portals as AdminPortal[]
  if (Array.isArray(b?.data)) return b.data as AdminPortal[]
  return []
}

test.describe('Portals directory — live post-prod', () => {
  test('1. the "Portals" nav entry renders and /portals mounts (flag ON + browser-disclosed)', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !HAS_SYNTHETIC_CREDS,
      `POST_PROD_PASSWORD not set — cannot sign in as ${EMAIL} to view the authenticated shell. ` +
        'The password has no in-repo fallback (public repo). This is MISSING COVERAGE, not a pass.'
    )

    const { pageErrors, failedRequests } = attachErrorCollectors(page)

    const { token, via } = await loginSyntheticViaApi(request, {
      email: EMAIL,
      password: PASSWORD!,
      internalSecret: INTERNAL_SECRET,
    })
    testInfo.annotations.push({ type: 'auth', description: `signed in via ${via}` })

    await page.addInitScript(seedMockSession, token)
    await page.goto('/dashboard')
    await page.waitForURL('**/dashboard', { timeout: 30_000 })

    // The flag chain's end-to-end proof: the nav entry is present. If the flag
    // were OFF — or ON in Unleash but not in WEB_EXPOSED_FLAGS — useFlag() would
    // return its OFF default and this entry would be absent.
    const portalsNav = page.getByText('Portals', { exact: true })
    await expect(
      portalsNav,
      'the "Portals" nav entry is absent — fuzefront.platform.portals-directory is OFF ' +
        'or not disclosed to the browser (WEB_EXPOSED_FLAGS) on the live deploy'
    ).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: 'test-results-post-prod/portals-01-nav.png', fullPage: true })

    // The page itself mounts. For a non-admin the panel may show the
    // permission-denied state — that is still "renders", and is asserted
    // precisely in test 2 for an admin. Here we only require that navigating
    // produces the directory panel chrome and no runtime/MF load error.
    await portalsNav.click()
    await page.waitForURL('**/portals', { timeout: 20_000 })
    await expect(
      page.locator('[data-panel="portals-directory"], [data-panel="permission-denied"]').first(),
      'the /portals page did not mount its panel (blank screen / crash on the live deploy)'
    ).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: 'test-results-post-prod/portals-02-page.png', fullPage: true })

    expect(pageErrors, `uncaught page errors on /portals: ${pageErrors.join(' | ')}`).toEqual([])
    expect(
      failedRequests,
      `failed app/API requests on /portals: ${failedRequests.join(' | ')}`
    ).toEqual([])
  })

  test('2. the directory lists the root + MendysRobotics portals (master-admin)', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !HAS_ADMIN_CREDS,
      `POST_PROD_ADMIN_PASSWORD not set — the portals directory (GET /api/v1/admin/portals) ` +
        `authorizes per-portal and only a root master-admin sees the fleet, so the two-portals ` +
        `assertion needs a dedicated admin synthetic (${ADMIN_EMAIL}). Provision one and set the ` +
        `POST_PROD_ADMIN_EMAIL / POST_PROD_ADMIN_PASSWORD secrets. This is MISSING COVERAGE, not a pass.`
    )
    testInfo.annotations.push({
      type: 'coverage',
      description: 'list-contents assertion requires the POST_PROD_ADMIN_PASSWORD secret',
    })

    const { pageErrors, failedRequests } = attachErrorCollectors(page)

    const { token } = await loginSyntheticViaApi(request, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD!,
      internalSecret: INTERNAL_SECRET,
      firstName: 'Post-prod',
      lastName: 'Admin',
    })

    // API is the source of truth for the fleet (slugs are stable; display names
    // are mutable). A 403/empty here means the synthetic is NOT actually a
    // master-admin — fail with that exact diagnosis rather than a vague miss.
    const apiResp = await request.get('/api/v1/admin/portals', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(
      apiResp.status(),
      `GET /api/v1/admin/portals -> ${apiResp.status()} (403/empty = ${ADMIN_EMAIL} is not a ` +
        `root master-admin; 502 = portals service not routable)`
    ).toBe(200)
    const portals = portalsFrom(await apiResp.json())
    const slugs = portals.map(p => p.slug)
    expect(
      slugs,
      `directory must list the root portal "${ROOT_PORTAL_SLUG}" — got ${JSON.stringify(slugs)}`
    ).toContain(ROOT_PORTAL_SLUG)
    expect(
      slugs,
      `directory must list "${MENDYS_PORTAL_SLUG}" (the first identity_mode:hard tenant) — got ${JSON.stringify(slugs)}`
    ).toContain(MENDYS_PORTAL_SLUG)

    // UI: the populated list renders at least those two rows.
    await page.addInitScript(seedMockSession, token)
    await page.goto('/portals')
    await page.waitForURL('**/portals', { timeout: 20_000 })

    const list = page.locator('[data-list="portals"]')
    await expect(
      list,
      'the populated portals list ([data-list="portals"]) did not render for the master-admin'
    ).toBeVisible({ timeout: 20_000 })

    const rows = page.locator('.pd-row[role="listitem"]')
    const rowCount = await rows.count()
    expect(
      rowCount,
      `expected at least 2 portal rows (root + MendysRobotics), got ${rowCount}`
    ).toBeGreaterThanOrEqual(2)

    // The distinctive hard-identity tenant must be visible by name.
    await expect(
      page.locator('.pd-row__name', { hasText: /mendys/i }).first(),
      'MendysRobotics row not rendered in the directory list'
    ).toBeVisible()

    await page.screenshot({ path: 'test-results-post-prod/portals-03-list.png', fullPage: true })

    expect(pageErrors, `uncaught page errors on /portals: ${pageErrors.join(' | ')}`).toEqual([])
    expect(
      failedRequests,
      `failed app/API requests on /portals: ${failedRequests.join(' | ')}`
    ).toEqual([])
  })
})
