import { test, expect } from '@playwright/test'
import { ROUTES } from './routes'

/**
 * Basic navigation smoke: every route in ROUTES loads, renders a real page
 * (not a blank shell), and doesn't throw a JS error or log a console error.
 * Cheap, fast, and catches the class of bug where a route 404s, a component
 * throws during render, or a chunk fails to load — none of which the
 * contrast spec (which only checks pixels once a page HAS rendered) would see.
 */
for (const route of ROUTES) {
  test(`loads cleanly: ${route}`, async ({ page }) => {
    // The pre-prod run previews the frontend alone (no backend behind it), so
    // AnalyticsContext's page-view/event beacons to /api/analytics/* have
    // nothing to answer them. Stub them rather than ignoring the resulting
    // console noise, so a real missing-asset/chunk 404 still fails the test.
    // The post-prod run, against the real deployed site with its backend,
    // exercises the beacons for real.
    // The cookie-consent banner is a fixed overlay that appears 2s after load
    // and would otherwise sit on top of whatever's scrolled underneath it —
    // pre-accept it so it never renders. Its own (plain white-card,
    // dark-on-light) contrast isn't in question; letting it render would just
    // occlude and corrupt every OTHER element's contrast measurement near the
    // bottom of the viewport (see contrast.spec.ts).
    await page.addInitScript(() => localStorage.setItem('cookie-consent', 'accepted'))
    await page.route('**/api/analytics/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    // Google Fonts is a real external CDN dependency (App.css @import) —
    // stub it so the suite doesn't depend on that CDN's availability from
    // wherever it runs (this sandbox's egress policy blocks it entirely;
    // real CI can reach it but shouldn't have to for a page-render smoke
    // test). The page falls back to its next font-family harmlessly.
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '/* stubbed in tests */' }))

    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => pageErrors.push(err.message))

    const response = await page.goto(route, { waitUntil: 'networkidle' })
    expect(response?.ok(), `${route} responded ${response?.status()}`).toBeTruthy()

    // The shell renders something real, not a blank <div id="root"></div>.
    await expect(page.locator('header, main, h1').first()).toBeVisible()

    expect(consoleErrors, `console errors on ${route}`).toEqual([])
    expect(pageErrors, `uncaught JS errors on ${route}`).toEqual([])
  })
}
