/**
 * Mocked authenticated shell for the account-security Playwright specs
 * (password-change / mfa-management / mfa-stepup-mobile).
 *
 * The host shell boots through several same-origin calls before any page body
 * renders (current user, the workspace-provisioning gate's organizations read,
 * the app registry, flags, notifications). Specs that exercise one account-
 * security surface mock those once here so the surface under test is reachable
 * without a live backend, and so the console / failed-request assertions are not
 * polluted by unrelated shell traffic. Mirrors portals-directory.frontend.spec.ts.
 *
 * Playwright matches the MOST RECENTLY registered route first, so a spec may
 * re-register any of these (e.g. `**\/v1/security/methods`) to override.
 */
import type { Page } from '@playwright/test'

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** Park an auth token exactly as a first sign-in does (frontend/src/lib/accounts.ts). */
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('ff.acct.__provisional__.authToken', 'e2e-mock-token')
    sessionStorage.setItem('ff.workspaceReady', '1')
  })
}

/**
 * Install the shell's boot mocks. `flags` is the body of `GET /api/flags`
 * (`{ flags: {...} }`) — pass the release flag under test ON/OFF.
 */
export async function installShellMocks(page: Page, flags: Record<string, boolean>): Promise<void> {
  await page.route('**/api/v1/security/session', route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill(
      json({
        user: {
          id: 'usr-e2e-1',
          email: 'amara@rowan.co',
          roles: ['user'],
          firstName: 'Amara',
          lastName: 'Rowan',
        },
      })
    )
  })
  await page.route('**/api/organizations', route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill(
      json({
        organizations: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Personal',
            slug: 'personal-e2e',
            type: 'personal',
            ownerId: 'usr-e2e-1',
          },
        ],
      })
    )
  })
  await page.route('**/api/v1/app-registry/apps**', route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return route.fulfill(json({ apps: [], nextCursor: null }))
  })
  await page.route('**/api/flags', route => route.fulfill(json({ flags })))
  await page.route('**/api/health', route => route.fulfill(json({ status: 'ok' })))
  await page.route('**/api/v1/notifications/unread-count**', route => route.fulfill(json({ count: 0 })))
  await page.route('**/api/v1/notifications/stream**', route =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  )
  await page.route('**/api/v1/security/methods', route =>
    route.fulfill(
      json({
        password: true,
        social: ['google'],
        mfa: { enabled: true, types: ['totp'] },
        verification: { email: true, sms: false },
      })
    )
  )
}

/**
 * Pre-existing shell noise that is NOT the surface under test (WebSocket to a
 * backend that is not running, telemetry export, Google Fonts, the api-client's
 * own request logging). Same allow-list as portals-directory.frontend.spec.ts.
 */
export const KNOWN_SHELL_NOISE_RE =
  /API (Health Check|Response Error|Request Setup Error)|Error Details:|fonts\.googleapis\.com|Unauthorized - clearing the active account session|WebSocket connection (error|to 'ws:\/\/)|Failed to load resource: (net::ERR_CONNECTION_RESET|the server responded with a status of)/i
