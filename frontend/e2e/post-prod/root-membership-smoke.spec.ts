import { test, expect, type Page } from '@playwright/test'
import { seedMockSession } from '../../tests/support/account-vault'
import { loginSyntheticViaApi } from '../../tests/support/post-prod-auth'

/**
 * POST-PRODUCTION smoke — the root-org membership repair (#750 / #1095) held on
 * the LIVE platform.
 *
 * Runs READ-ONLY against the live platform (default https://app.fuzefront.com
 * via playwright.post-prod.config.ts) in the same post-prod job that
 * `prod-post-deploy.yml` invokes after every release, so a deploy that
 * re-introduces the #750 symptom fails loudly instead of being found in a
 * screenshot.
 *
 * WHAT #1095 FIXED, and what this asserts. Before migrations 029 (monolith) /
 * 020 (security), every human — the platform owner included — was a GUEST of
 * the root org (`ROOT_ORG_ID` …010) and the "Your organizations" screen 500'd
 * on the root-absence path. The migrations (a) set the root's human owner and
 * (b) backfilled a `member` membership for EVERY user. So for ANY real signed-in
 * user, the organizations list must now:
 *   - return HTTP 200 (the #750 500 is gone), and
 *   - contain the root org with a REAL role — never `guest`/null (the universal
 *     membership backfill makes every user at least a `member`).
 *
 * Account-agnostic on purpose: this uses the ordinary self-provisioning
 * synthetic (not a privileged account), because "every user is a member of
 * root" is precisely the invariant #1095 established — the synthetic is as good
 * a witness as any. It does NOT assert WHO owns root (that is a specific person,
 * verified out-of-band via docs/runbooks/verify-1095-root-owner-backfill.md);
 * it asserts the invariant that held for the whole user base.
 *
 * Skips loudly if POST_PROD_PASSWORD is unset (same contract as live-smoke
 * test 7 — missing coverage, never a guessable fallback).
 */

const EMAIL = process.env.POST_PROD_EMAIL || 'postprod-smoke@fuzefront.com'
const PASSWORD = process.env.POST_PROD_PASSWORD
const INTERNAL_SECRET = process.env.INTERNAL_PROVISION_SECRET
const HAS_SYNTHETIC_CREDS = Boolean(PASSWORD)

// The canonical root org id (frontend/src/lib/shared.tsx `ROOT_ORG_ID`).
const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'

// Any of these means "a real membership". The #750 regression rendered the
// root with no role at all (GUEST / null) — that is the failure this catches.
const REAL_ROLES = new Set(['owner', 'admin', 'member', 'viewer', 'developer'])

interface OrgRow {
  id: string
  name?: string
  user_role?: string | null
}

/** Normalise the organizations response to an array across response shapes. */
function orgsFrom(body: unknown): OrgRow[] {
  if (Array.isArray(body)) return body as OrgRow[]
  const b = body as Record<string, unknown>
  if (Array.isArray(b?.items)) return b.items as OrgRow[]
  if (Array.isArray(b?.organizations)) return b.organizations as OrgRow[]
  if (Array.isArray(b?.data)) return b.data as OrgRow[]
  return []
}

function attachErrorCollectors(page: Page) {
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on('pageerror', (err: Error) => pageErrors.push(err.message))
  page.on('requestfailed', req => {
    const url = req.url()
    if (/\/api\/organizations|\/api\/|remoteEntry|\.js(\?|$)/i.test(url)) {
      failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? 'failed'}`)
    }
  })
  return { pageErrors, failedRequests }
}

test.describe('Root-org membership repair (#750/#1095) — live post-prod', () => {
  test('1. a real user is a member of root — GET /api/organizations is 200 and root carries a real role (not GUEST)', async ({
    request,
  }, testInfo) => {
    test.skip(
      !HAS_SYNTHETIC_CREDS,
      `POST_PROD_PASSWORD not set — cannot sign in as ${EMAIL} to read /api/organizations. ` +
        'The password has no in-repo fallback (public repo). This is MISSING COVERAGE, not a pass.'
    )

    const { token, via } = await loginSyntheticViaApi(request, {
      email: EMAIL,
      password: PASSWORD!,
      internalSecret: INTERNAL_SECRET,
    })
    testInfo.annotations.push({ type: 'auth', description: `signed in via ${via}` })

    const resp = await request.get('/api/organizations', {
      headers: { Authorization: `Bearer ${token}` },
    })
    // The #750 symptom was a 500 on the root-absence path. A real user's org
    // list must now load.
    expect(
      resp.status(),
      `GET /api/organizations -> ${resp.status()} (500 = the #750 root-absence crash is BACK; ` +
        '502 = identity backend not routable)'
    ).toBe(200)

    const orgs = orgsFrom(await resp.json())
    const root = orgs.find(o => o.id === ROOT_ORG_ID)
    expect(
      root,
      `the root org ${ROOT_ORG_ID} is absent from the signed-in user's org list — the universal ` +
        'root-membership backfill (#1095 migration 029/020) did not hold on this deploy. ' +
        `got ids: ${JSON.stringify(orgs.map(o => o.id))}`
    ).toBeTruthy()

    const role = (root!.user_role ?? '').toLowerCase()
    expect(
      REAL_ROLES.has(role),
      `root org role is "${root!.user_role ?? '<null>'}", not a real membership — this is exactly ` +
        'the #750 GUEST regression (the backfill gives every user at least `member`).'
    ).toBe(true)
  })

  test('2. the "Your organizations" screen renders live — /api/organizations 200 + no runtime crash', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !HAS_SYNTHETIC_CREDS,
      `POST_PROD_PASSWORD not set — cannot sign in as ${EMAIL} to render /organizations. ` +
        'This is MISSING COVERAGE, not a pass.'
    )

    const { token, via } = await loginSyntheticViaApi(request, {
      email: EMAIL,
      password: PASSWORD!,
      internalSecret: INTERNAL_SECRET,
    })
    testInfo.annotations.push({ type: 'auth', description: `signed in via ${via}` })

    const { pageErrors, failedRequests } = attachErrorCollectors(page)

    // Capture the live org-list response the SPA itself makes — the UI-layer
    // witness that the #750 500 is gone, selector-free so it is not brittle to
    // the personal-context flag (MyOrganizationsPage vs OrganizationPage).
    const orgApiStatuses: number[] = []
    page.on('response', r => {
      if (/\/api\/organizations(\?|$)/.test(r.url())) orgApiStatuses.push(r.status())
    })

    await page.addInitScript(seedMockSession, token)
    await page.goto('/organizations')
    await page.waitForURL('**/organizations', { timeout: 30_000 })
    // Let the page issue its org-list fetch and settle.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})

    await page.screenshot({
      path: 'test-results-post-prod/root-membership-01-organizations.png',
      fullPage: true,
    })

    expect(
      orgApiStatuses.length > 0,
      'the /organizations screen never called GET /api/organizations — the page likely did not mount'
    ).toBe(true)
    expect(
      orgApiStatuses.every(s => s === 200),
      `the live /organizations screen saw a non-200 from /api/organizations: ${JSON.stringify(orgApiStatuses)} ` +
        '(500 = the #750 root-absence crash is back)'
    ).toBe(true)
    expect(pageErrors, `uncaught page errors on /organizations: ${pageErrors.join(' | ')}`).toEqual([])
    expect(
      failedRequests,
      `failed app/API requests on /organizations: ${failedRequests.join(' | ')}`
    ).toEqual([])
  })
})
