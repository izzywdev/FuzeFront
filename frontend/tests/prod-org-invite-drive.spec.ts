/**
 * PRODUCTION org-invite drive — full UI path, no API shortcuts.
 *
 * Drives the real invitation flow end-to-end through the shell exactly as a
 * human would:
 *
 *   sign in → /organizations → select the root platform org → Members tab
 *     → "Invite member" → email + role=Admin → "Send invite"
 *     → Pending Invitations lists the invitee as Admin
 *
 * This is a MUTATING drive against a live target: a successful run really does
 * create a pending invitation and really does publish the invite email event.
 * It is therefore kept OUT of the read-only post-prod smoke suite
 * (`playwright.post-prod.config.ts`) and is opt-in via env.
 *
 * Re-runnable: `POST /organizations/:id/invitations` answers 409 when a pending
 * invitation for the same email already exists (see security-service
 * routes/organizations.ts), so a second run asserts the existing invitation
 * rather than failing. The drive is about reaching the verified end state, not
 * about being the one who created it.
 *
 * Env:
 *   PROD_BASE_URL        target origin (default https://app.fuzefront.com)
 *   INVITE_EMAIL         invitee (default weinberg770@gmail.com)
 *   INVITE_ROLE          admin | member | viewer (default admin)
 *   INVITE_ORG_NAME      org to invite into by name (default: the root platform org)
 *   AUTHN_TEST_EMAIL     password account that is owner/admin on that org
 *   AUTHN_TEST_PASSWORD
 *
 * Run:
 *   AUTHN_TEST_EMAIL=... AUTHN_TEST_PASSWORD=... \
 *     npx playwright test --config playwright.prod.config.ts \
 *     --project chromium --grep "@org-invite"
 *
 * The inviter MUST be owner or admin on the target org — the "Invite member"
 * button is rendered only for those roles (IdentityPage), and the API answers
 * 403 otherwise. A viewer/member account fails this test by design.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

const INVITE_EMAIL = (process.env.INVITE_EMAIL ?? 'weinberg770@gmail.com').toLowerCase()
const INVITE_ROLE = (process.env.INVITE_ROLE ?? 'admin').toLowerCase()
/**
 * Which org to invite into. Defaults to the ROOT organization, matched by its
 * `platform` TYPE rather than by name — deliberately.
 *
 * Migration `015_seed_root_platform_organization` seeds the root as
 * name `FuzeFront` / slug `fuzefront`, but it *adopts* any pre-existing
 * `type = 'platform'` row instead of creating a second one, so an environment
 * that already had a root org keeps whatever that row was called. The name is
 * therefore environment-dependent while "the single platform-type org" is not.
 * The org picker renders each option as `<name> (<type>)`, which makes the type
 * matchable straight from the UI.
 *
 * Set INVITE_ORG_NAME to target a specific org by name instead.
 */
const INVITE_ORG_NAME = process.env.INVITE_ORG_NAME ?? ''
const ORG_OPTION_RE = INVITE_ORG_NAME
  ? new RegExp(INVITE_ORG_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  : /\(platform\)\s*$/i
const ORG_LABEL = INVITE_ORG_NAME || 'the root platform organization'
const AUTHN_TEST_EMAIL = process.env.AUTHN_TEST_EMAIL ?? ''
const AUTHN_TEST_PASSWORD = process.env.AUTHN_TEST_PASSWORD ?? ''

// Role label as rendered by identity-ui's en locale (`roles.admin` = 'Admin').
const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

/**
 * Runtime-cleanliness collector — the CLAUDE.md console-clean gate. A UI drive
 * that "passes" while the console is throwing is not a pass: an uncaught
 * exception, a CSP/mixed-content block, or a failed app request all produce a
 * green-looking click-through over a broken page.
 *
 * Third-party noise is not filtered out wholesale; only same-origin app failures
 * are asserted on, so an unrelated analytics 404 cannot mask a real regression
 * and cannot cause a false failure either.
 */
function collectRuntimeErrors(page: Page, appOrigin: string) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => pageErrors.push(String(err)))
  page.on('response', res => {
    if (res.status() >= 400 && res.url().startsWith(appOrigin)) {
      // 401/403/409 are legitimate *application* answers the drive asserts on
      // deliberately (unauthenticated first paint, duplicate invite). Only
      // 5xx and asset 404s indicate a broken deployment.
      if (res.status() >= 500 || res.status() === 404) {
        failedRequests.push(`${res.status()} ${res.url()}`)
      }
    }
  })

  return { consoleErrors, pageErrors, failedRequests }
}

async function signInWithPassword(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').first().fill(AUTHN_TEST_EMAIL)
  await page.locator('input[type="password"]').first().fill(AUTHN_TEST_PASSWORD)
  await page.getByRole('button', { name: /^sign in$/i }).click()

  // The shell lands on /dashboard after a successful session exchange.
  await page.waitForURL(/\/(dashboard|organizations)?$/, { timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Root organization — invite member (production drive)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test(`invites ${INVITE_EMAIL} as ${INVITE_ROLE} to ${ORG_LABEL} @org-invite`, async ({
    page,
    baseURL,
  }) => {
    test.skip(
      !AUTHN_TEST_EMAIL || !AUTHN_TEST_PASSWORD,
      'AUTHN_TEST_EMAIL/AUTHN_TEST_PASSWORD not set — cannot sign in to drive the invite'
    )

    const appOrigin = new URL(baseURL ?? 'https://app.fuzefront.com').origin
    const runtime = collectRuntimeErrors(page, appOrigin)

    // ── 1. Sign in ────────────────────────────────────────────────────────
    await signInWithPassword(page)

    // ── 2. Organizations page ─────────────────────────────────────────────
    await page.goto('/organizations')

    // The org picker is a native <select> whose option labels render as
    // "<name> (<type>)" — see ORG_OPTION_RE above for why the default matches
    // on the `platform` type rather than on a name.
    const orgSelect = page.locator('select').first()
    await expect(orgSelect, 'organization picker is present').toBeVisible({ timeout: 30_000 })

    const orgOption = orgSelect.locator('option', { hasText: ORG_OPTION_RE })
    await expect(
      orgOption,
      `exactly one option matching ${ORG_OPTION_RE} is listed for this account. Zero means the ` +
        `org does not exist (migration 015_seed_root_platform_organization has not run) or the ` +
        `signed-in user has no membership on it — GET /api/organizations lists by membership, so ` +
        `the root org is invisible until ensureRootOrgAdmins() grants this user on it. More than ` +
        `one means the match is ambiguous; set INVITE_ORG_NAME to disambiguate.`
    ).toHaveCount(1)

    const orgOptionLabel = (await orgOption.innerText()).trim()
    await orgSelect.selectOption({ label: orgOptionLabel })

    // The heading renders the org NAME only, so derive it from the option label
    // by stripping the trailing " (<type>)" the picker appends.
    const orgName = orgOptionLabel.replace(/\s*\([^)]*\)\s*$/, '')
    await expect(
      page.getByRole('heading', { name: new RegExp(orgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    ).toBeVisible()

    // ── 3. Members tab ────────────────────────────────────────────────────
    await page.getByRole('button', { name: /Members/i }).first().click()

    // ── 4. Open the invite modal ──────────────────────────────────────────
    // Rendered only for owner/admin — its absence is an authorization failure,
    // not a flake, so say so in the assertion.
    const inviteButton = page.getByRole('button', { name: /invite member/i })
    await expect(
      inviteButton,
      'the "Invite member" button renders only for owner/admin — the signed-in user is not an ' +
        'admin of this organization'
    ).toBeVisible({ timeout: 30_000 })
    await inviteButton.click()

    await expect(page.getByText(/invite members/i).first()).toBeVisible()

    // ── 5. Fill the single-invite form ────────────────────────────────────
    await page.getByLabel(/^email$/i).fill(INVITE_EMAIL)
    await page.getByLabel(/^role$/i).selectOption(INVITE_ROLE)

    // Capture the API answer so a duplicate (409) is distinguishable from a
    // real failure without inspecting the DOM for an error toast.
    const invitePost = page.waitForResponse(
      res =>
        res.url().includes('/invitations') &&
        res.request().method() === 'POST' &&
        !res.url().includes('/bulk'),
      { timeout: 30_000 }
    )

    await page.getByRole('button', { name: /send invite/i }).click()

    const response = await invitePost
    const status = response.status()

    expect(
      [201, 409],
      `invite POST answered ${status} — expected 201 (created) or 409 (already pending). ` +
        `403 means the inviter is not an org admin; 400 means the role was rejected.`
    ).toContain(status)

    if (status === 201) {
      const body = await response.json()
      expect(body.invitation.email).toBe(INVITE_EMAIL)
      expect(body.invitation.role).toBe(INVITE_ROLE)
      expect(body.invitation.status).toBe('pending')
    }

    // ── 6. Verify the end state in the UI ─────────────────────────────────
    // Assert on what the org actually shows, not on the click that produced it,
    // so the 201 and 409 paths converge on the same verified state.
    await page.getByRole('button', { name: /pending invitations/i }).click()

    const inviteRow = page.getByRole('row', { hasText: INVITE_EMAIL })
    await expect(inviteRow, 'invitee appears in Pending Invitations').toBeVisible({
      timeout: 30_000,
    })
    await expect(
      inviteRow.getByText(new RegExp(`^${ROLE_LABEL[INVITE_ROLE] ?? INVITE_ROLE}$`, 'i')),
      `invitation is scoped to the ${INVITE_ROLE} role`
    ).toBeVisible()

    // ── 7. Console-clean gate ─────────────────────────────────────────────
    expect(runtime.pageErrors, 'uncaught exceptions during the drive').toEqual([])
    expect(
      runtime.consoleErrors.filter(e => !/favicon/i.test(e)),
      'console errors during the drive'
    ).toEqual([])
    expect(runtime.failedRequests, 'failed same-origin app requests (5xx / 404)').toEqual([])
  })
})
