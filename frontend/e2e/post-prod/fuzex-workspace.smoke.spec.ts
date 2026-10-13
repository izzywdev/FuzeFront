import { test, expect, type Page } from '@playwright/test'
import { seedMockSession } from '../../tests/support/account-vault'

/**
 * FuzeX's live, tenant-scoped acceptance journey.
 *
 * This is deliberately a browser-only consumer of the portal: it never creates
 * projects, imports frames, changes approvals, or changes policy.  Production
 * design evidence belongs to the tenant that owns it, so a post-production
 * check must show the deployed portal with the same FuzeFront session an actual
 * member receives rather than exercising FuzeX through a privileged back door.
 *
 * Required workflow secrets: POST_PROD_EMAIL and POST_PROD_PASSWORD.  The
 * FuzeFront post-prod job already owns those secrets and provisions the
 * dedicated synthetic account.  If either is absent, this check is skipped
 * loudly; a successful run always retains a WebM and full-page screenshots.
 */

const EMAIL = process.env.POST_PROD_EMAIL
const PASSWORD = process.env.POST_PROD_PASSWORD
const HAVE_CREDS = Boolean(EMAIL && PASSWORD)

type RegisteredApp = {
  id: string
  name?: string
  slug?: string
  integrationType?: string
  isHealthy?: boolean
}

async function authenticate(page: Page): Promise<string> {
  const response = await page.request.post('/api/v1/security/session', {
    data: { email: EMAIL, password: PASSWORD },
  })
  expect(
    response.status(),
    `FuzeX post-prod synthetic sign-in -> ${response.status()} (the dedicated POST_PROD credentials must be valid)`
  ).toBe(200)
  const body = await response.json()
  expect(body.status, 'FuzeX synthetic must not be held at MFA step-up').not.toBe('mfa_required')
  expect(body.token, 'FuzeFront Security must return a portal session token').toBeTruthy()
  return body.token as string
}

function fuzexApp(apps: RegisteredApp[]): RegisteredApp | undefined {
  return apps.find((app) =>
    [app.id, app.name, app.slug].filter(Boolean).some((value) => /fuzex/i.test(String(value)))
  )
}

test.describe('@postprod FuzeX workspace — live portal evidence', () => {
  test.skip(
    !HAVE_CREDS,
    'FuzeX post-prod coverage is missing: configure POST_PROD_EMAIL and POST_PROD_PASSWORD workflow secrets'
  )

  test('portal remote → app workspace → imported flow/frame preview → decision traceability', async ({ page, request }) => {
    test.setTimeout(120_000)
    const token = await authenticate(page)

    // The app registry is still the portal’s source for the Module Federation
    // route.  Resolve the FuzeX entry rather than baking a deployment-specific
    // application UUID into a test or a recording.
    const registryResponse = await request.get('/api/apps', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(registryResponse.status(), '/api/apps should expose the FuzeX remote to this tenant').toBe(200)
    const registryPayload = await registryResponse.json()
    const apps: RegisteredApp[] = Array.isArray(registryPayload)
      ? registryPayload
      : registryPayload?.apps ?? registryPayload?.data ?? []
    const app = fuzexApp(apps)
    expect(app, 'FuzeX must be registered in the live portal application catalog').toBeTruthy()
    expect(app?.integrationType, 'FuzeX must be mounted through Module Federation').toBe('module-federation')
    expect(app?.isHealthy, 'portal catalog must not mark FuzeX unhealthy').not.toBe(false)

    await page.addInitScript(seedMockSession, token)
    await page.goto(`/app/${app!.id}`)

    await expect(page.getByRole('heading', { name: /apps, flows & reviews/i })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/imported app frames, revision history, and per-flow review/i)).toBeVisible()
    await page.screenshot({ path: 'test-results-post-prod/fuzex-01-workspace-list.png', fullPage: true })

    await page.getByRole('button', { name: /open app workspace/i }).first().click()
    await expect(page.getByRole('heading', { name: /ux areas & flows/i })).toBeVisible({ timeout: 30_000 })

    // The traceability/policy UI is shown for every app workspace.  This does
    // not create links or policies; it proves the rationalisation controls are
    // deployed and tenant-scoped for the authenticated member.
    const traceability = page.getByRole('heading', { name: /decision traceability & agent policies/i })
    await expect(traceability, 'FuzePlan/FuzeQuality decision traceability UI must be deployed').toBeVisible()
    await expect(page.getByText(/only explicitly approved policies are available to ai agents/i)).toBeVisible()
    await page.screenshot({ path: 'test-results-post-prod/fuzex-02-traceability-policy.png', fullPage: true })

    // An empty workspace is an explicit deployment/import failure: the test is
    // evidence for the migrated FuzeOne wireframes, not merely remote loading.
    const workspaceLinks = page.getByRole('button', { name: /review frames|generate flow here/i })
    await expect(
      workspaceLinks.first(),
      'the live FuzeX tenant has no imported UX area; import/adoption has not completed'
    ).toBeVisible({ timeout: 30_000 })

    // Review Frames enters the immutable frame/revision surface.  The preview
    // is sandboxed by FuzeX; assert the iframe itself, not frame DOM contents,
    // to retain that isolation boundary in the test.
    await page.getByRole('button', { name: /review frames/i }).first().click()
    await expect(page.getByRole('heading').filter({ hasText: /.+/ }).first()).toBeVisible()
    const preview = page.locator('iframe[title^="Frame preview:"]')
    await expect(preview, 'an imported frame must render through the isolated preview').toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Flows', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results-post-prod/fuzex-03-frame-preview.png', fullPage: true })
  })
})
