import { test, expect } from '@playwright/test'
import { ROUTES } from './routes'
import { scanEntirePageTextContrast } from './utils/contrast'

/**
 * "Is every piece of text actually visible against what's behind it?" —
 * across every route, at real rendered pixels (see utils/contrast.ts for why
 * this can't be a CSS-only / axe-core color-contrast check on this site).
 *
 * This is the regression test for two real incidents:
 *   - Header/Footer toggling transparent based on scroll position, leaving
 *     white nav text over a light section behind it.
 *   - HomePage's (and four other pages') hero combining a Tailwind gradient
 *     background with the `.hero-pattern` class on the same element — both
 *     set `background-image`, so the gradient silently disappeared and white
 *     hero text sat on an effectively blank/transparent section.
 */
for (const route of ROUTES) {
  test(`all text meets WCAG contrast: ${route}`, async ({ page }) => {
    // The cookie-consent banner is a fixed overlay that would otherwise sit on
    // top of whatever's scrolled underneath it, corrupting that content's
    // measured "background" with the banner's own pixels instead. Pre-accept
    // it so it never renders (its own contrast is a plain, safely-compliant
    // dark-on-white card, not what this spec is checking). See navigation.spec.ts.
    await page.addInitScript(() => localStorage.setItem('cookie-consent', 'accepted'))
    // No backend behind the pre-prod preview — stub the analytics beacons so
    // `networkidle` doesn't wait out failed-request retries. See navigation.spec.ts.
    await page.route('**/api/analytics/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    // See navigation.spec.ts — stub the external Google Fonts CDN so the
    // suite doesn't depend on its availability from wherever it runs.
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '/* stubbed in tests */' }))
    await page.goto(route, { waitUntil: 'networkidle' })
    // Let the cookie-consent banner (and its focus/backdrop) settle so it
    // doesn't get scanned mid-animation on every single route.
    await page.waitForTimeout(500)

    const violations = await scanEntirePageTextContrast(page)

    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `  ${v.selector} "${v.text}" — text ${v.textColor} on measured background ${v.backgroundColor} ` +
            `→ ratio ${v.ratio}:1, needs ${v.required}:1 (font ${v.fontSizePx}px/${v.fontWeight}) at (${Math.round(v.rect.x)},${Math.round(v.rect.y)})`
        )
        .join('\n')
      console.log(`Contrast violations on ${route}:\n${report}`)
    }

    expect(violations, `contrast violations on ${route}`).toEqual([])
  })
}
