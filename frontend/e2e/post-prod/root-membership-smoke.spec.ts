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
 * (b) backfilled a `member` membership for EVERY user. That baseline root
 * membership is now deliberately NOT surfaced in the ordinary user's org list
 * (owner decision: list only orgs with a DIRECT role; root stays visible to
 * employees / platform admins only). So for an ordinary signed-in user the
 * organizations list must:
 *   - return HTTP 200 (the #750 500 is gone), and
 *   - NOT contain the root org, and
 *   - carry a REAL role on every row it does list — never `guest`/null.
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
    const failure = req.failure()?.errorText ?? 'failed'
    // Navigating away closes the notification SSE/poll requests by design.
    // Do not turn that browser cancellation into a false product regression.
    if (failure === 'net::ERR_ABORTED' && /\/api\/v1\/notifications\/(?:unread-count|stream)/.test(url)) {
      return
    }
    if (/\/api\/organizations|\/api\/|remoteEntry|\.js(\?|$)/i.test(url)) {
      failedRequests.push(`${req.method()} ${url} :: ${failure}`)
    }
  })
  return { pageErrors, failedRequests }
}

test.describe('Root-org membership repair (#750/#1095) — live post-prod', () => {
  test('1. GET /api/organizations is 200, lists only direct-role orgs, and hides root from an ordinary user', async ({
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

    // Owner decision (org-list direct-membership filter): the list shows ONLY
    // orgs where the caller holds a DIRECT role. Every user is a baseline
    // `member` of root (the #1095 backfill), so root is deliberately HIDDEN from
    // ordinary users — only employees / platform admins keep it in their list.
    // The synthetic is an ordinary self-provisioned user, so root must be
    // absent. (Whether the backfill itself held is verified server-side by
    // backend/security/tests/migrations.rootMembershipBackfill.test.ts and the
    // out-of-band runbook docs/runbooks/verify-1095-root-owner-backfill.md.)
    expect(
      orgs.find(o => o.id === ROOT_ORG_ID),
      `the root org ${ROOT_ORG_ID} is present in an ordinary user's org list — the ` +
        'direct-membership-only visibility filter did not hold on this deploy ' +
        '(fuzefront.identity.org-list-direct-only-kill-switch OFF, or the filter regressed). ' +
        `got ids: ${JSON.stringify(orgs.map(o => o.id))}`
    ).toBeUndefined()

    // Whatever IS listed is a real direct membership — never a GUEST / null-role
    // row (the #750 regression rendered an org with no role at all).
    for (const o of orgs) {
      const role = (o.user_role ?? '').toLowerCase()
      expect(
        REAL_ROLES.has(role),
        `org ${o.id} is listed with role "${o.user_role ?? '<null>'}", not a real direct membership`
      ).toBe(true)
    }
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
